import type { ZodType } from 'zod';

import type { Disposable, HostEventListener, HostEvents, Logger, PluginHost } from '../host.js';
import type { GuestChannel } from './channel.js';
import {
  NOT_YET_ISOLATED,
  type PointSpec,
  type RegisterMethod,
  ISOLATED_POINTS,
} from './points.js';
import {
  type GuestMessage,
  type HostMessage,
  RPC_PROTOCOL_VERSION,
  type Registration,
  describeIssues,
  hostMessageSchema,
} from './protocol.js';

/**
 * The plugin's side of isolation: a `PluginHost` whose every call is a message (ADR 0041).
 *
 * This runs inside the plugin's process — a worker thread in the CLI — and is the only
 * `PluginHost` an installed plugin ever holds. Registering keeps the functions here and
 * sends the rest; the host calls a function back by handle, and the arguments are checked
 * against the point's schema **here**, before the plugin's code sees them.
 *
 * `load` is the app's: it imports the plugin's module, which is the one thing this package
 * cannot do without naming a disk (ADR 0010).
 */

interface Kept {
  readonly spec: PointSpec;
  readonly name: string;
  readonly fn: (...args: readonly unknown[]) => unknown;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function runGuest(channel: GuestChannel, load: () => Promise<unknown>): void {
  const kept = new Map<number, Kept>();
  const listeners = new Map<string, Set<(payload: never) => void>>();
  let pending: (Registration & { readonly key: object })[] | undefined = [];
  let config: unknown;
  let nextHandle = 0;

  function send(message: GuestMessage): void {
    channel.send(message);
  }

  const log: Logger = Object.fromEntries(
    (['debug', 'info', 'warn', 'error'] as const).map((level) => [
      level,
      (message: string, detail?: unknown) => {
        const base = { protocol: RPC_PROTOCOL_VERSION, type: 'log', level, message } as const;
        try {
          send(detail === undefined ? base : { ...base, detail });
        } catch {
          // A detail that cannot be cloned — a function, a socket — still says something
          // as text, and a log line is not worth failing the plugin over.
          send({ ...base, detail: String(detail) });
        }
      },
    ]),
  ) as unknown as Logger;

  function register(method: RegisterMethod, value: object): Disposable {
    // The object itself, not a copy: a spread would drop the methods of a class instance.
    const contribution = value as Record<string, unknown>;
    const refused = NOT_YET_ISOLATED[method];
    if (refused !== undefined) {
      throw new TypeError(
        `extension point '${refused}' is not available to an isolated plugin yet`,
      );
    }

    const [point, spec] = Object.entries(ISOLATED_POINTS).find(
      ([, candidate]) => candidate.method === method,
    ) as [string, PointSpec];

    const data: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(contribution)) {
      if (name in spec.callables) continue;
      if (typeof value === 'function') {
        throw new TypeError(
          `a '${point}' contribution cannot carry a function in '${name}'; only ` +
            `${Object.keys(spec.callables).join(', ') || 'data'} crosses to the host`,
        );
      }
      data[name] = value;
    }
    // Read by name rather than from the entries, so an exporter written as a class — whose
    // methods live on the prototype — crosses the same as an object literal.
    for (const name of Object.keys(spec.callables)) {
      const fn: unknown = contribution[name];
      if (typeof fn !== 'function') continue;
      const handle = nextHandle++;
      kept.set(handle, {
        spec,
        name,
        fn: (fn as (...args: readonly unknown[]) => unknown).bind(contribution),
      });
      data[name] = { $call: handle };
    }

    const key = {};
    const id = String(data['id']);
    pending?.push({ point, contribution: data, key });
    return {
      dispose: () => {
        if (pending !== undefined) {
          pending = pending.filter((registration) => registration.key !== key);
          return;
        }
        send({ protocol: RPC_PROTOCOL_VERSION, type: 'withdrawn', point, id });
      },
    };
  }

  const host: PluginHost = {
    registerExporter: (value) => register('registerExporter', value),
    registerSource: (value) => register('registerSource', value),
    registerSink: (value) => register('registerSink', value),
    registerRasterizer: (value) => register('registerRasterizer', value),
    registerTemplatePack: (value) => register('registerTemplatePack', value),
    registerDirective: (value) => register('registerDirective', value),
    registerCommand: (value) => register('registerCommand', value),
    registerKeymap: (value) => register('registerKeymap', value),
    registerPanel: (value) => register('registerPanel', value),
    config<T>(schema: ZodType<T>): T {
      const parsed = schema.safeParse(config);
      if (!parsed.success) {
        throw new TypeError(
          `its configuration does not match the schema it asked for: ${describeIssues(parsed.error)}`,
        );
      }
      return parsed.data;
    },
    log,
    events: {
      on<Event extends keyof HostEvents>(event: Event, listener: HostEventListener<Event>) {
        const set = listeners.get(event) ?? new Set();
        listeners.set(event, set);
        set.add(listener as (payload: never) => void);
        return { dispose: () => void set.delete(listener as (payload: never) => void) };
      },
      // Local. The host's events are the host's to raise; a plugin announcing that
      // something was registered would be a plugin speaking for the registry.
      emit<Event extends keyof HostEvents>(event: Event, payload: HostEvents[Event]) {
        for (const listener of listeners.get(event) ?? []) {
          try {
            (listener as unknown as (value: typeof payload) => void)(payload);
          } catch {
            /* a listener's bug is not the plugin's failure */
          }
        }
      },
    },
  };

  async function activate(message: Extract<HostMessage, { type: 'activate' }>): Promise<void> {
    config = message.config;
    try {
      const module = (await load()) as { readonly activate?: unknown } | undefined;
      const entry = module?.activate;
      if (typeof entry !== 'function') throw new Error('its module exports no activate function');
      (entry as (host: PluginHost) => unknown)(host);
      const registrations = (pending ?? []).map(({ point, contribution }) => ({
        point,
        contribution,
      }));
      send({ protocol: RPC_PROTOCOL_VERSION, type: 'activated', registrations });
      pending = undefined;
    } catch (cause) {
      // Whatever it was — a throw from `activate`, a refused point, a contribution that
      // could not be cloned — the plugin did not finish, and that is the whole answer.
      send({ protocol: RPC_PROTOCOL_VERSION, type: 'failed', problem: messageOf(cause) });
    }
  }

  async function call(message: Extract<HostMessage, { type: 'call' }>): Promise<void> {
    const { id } = message;
    const target = kept.get(message.handle);
    if (target === undefined) {
      send({
        protocol: RPC_PROTOCOL_VERSION,
        type: 'thrown',
        id,
        problem: `no function has handle ${String(message.handle)}`,
      });
      return;
    }

    const args = target.spec.callables[target.name]?.args.safeParse(message.args);
    if (args === undefined || !args.success) {
      send({
        protocol: RPC_PROTOCOL_VERSION,
        type: 'thrown',
        id,
        problem: `the host called ${target.name} with arguments its schema refuses: ${args === undefined ? 'no schema' : describeIssues(args.error)}`,
      });
      return;
    }

    try {
      const value = await target.fn(...args.data);
      send({ protocol: RPC_PROTOCOL_VERSION, type: 'result', id, value });
    } catch (cause) {
      send({ protocol: RPC_PROTOCOL_VERSION, type: 'thrown', id, problem: messageOf(cause) });
    }
  }

  channel.onMessage((raw) => {
    const parsed = hostMessageSchema.safeParse(raw);
    if (!parsed.success) {
      log.error(`the host sent a message this plugin cannot read: ${describeIssues(parsed.error)}`);
      return;
    }
    const message = parsed.data;
    if (message.type === 'activate') void activate(message);
    else if (message.type === 'call') void call(message);
    else host.events.emit(message.event, message.payload);
  });

  channel.send({ type: 'hello', protocol: RPC_PROTOCOL_VERSION });
}
