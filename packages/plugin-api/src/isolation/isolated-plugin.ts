import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

import {
  type HostCapabilities,
  type HostFetchInit,
  PluginCapabilityError,
  checkedCapabilities,
} from '../capabilities.js';
import type { Disposable, Logger, Plugin, PluginHost } from '../host.js';
import { validatePluginManifest } from '../manifest.js';
import type { PluginChannel } from './channel.js';
import { type CallableSpec, type PointSpec, pointSpecOf } from './points.js';
import {
  type GuestMessage,
  RPC_PROTOCOL_VERSION,
  type Registration,
  callHandleSchema,
  credentialsArgsSchema,
  describeIssues,
  fetchArgsSchema,
  guestMessageSchema,
  helloMessageSchema,
} from './protocol.js';

/**
 * The host's side of isolation: a plugin in another process, as a `Plugin` (ADR 0041).
 *
 * The guest is activated **once**, in its own process, and answers with what it
 * registered. What this returns is an ordinary `Plugin` whose `activate` replays those
 * registrations into whichever host it is given — so an isolated plugin goes through
 * `tryActivate` like any other, and every check TYTO-47 put on that door (the manifest,
 * the name, duplicate ids, undeclared points) applies without being written twice. The
 * CLI activates into a host per task; the process behind them is one.
 *
 * **A crash is data.** When the process ends and nobody asked it to, every call waiting on
 * it — and every call after — answers `E_PLUGIN_CRASHED` in the shape the caller expected,
 * so a job reports a frame that failed and moves on to the next one. `onCrash` is told
 * once, which is how `plugin list` comes to show it.
 *
 * **A plugin that does not answer is ended** (ADR 0042). Every call, and the activation,
 * has a deadline; one that passes answers `E_PLUGIN_TIMEOUT`, ends the process, and counts
 * as a crash — a plugin stuck in `while (true) {}` is the thing isolation is for, and a
 * render waiting on it forever would be the render it took down.
 */

/**
 * How long a plugin has to answer one call, or to finish activating.
 *
 * 30 s, the capture deadline of ADR 0030, for the same reason: one frame's work is
 * milliseconds when it works, a person staring at a stuck export gives up well before a
 * minute, and a legitimate call that needs a slow `host.fetch` still has room. A frame is
 * the unit either way, so the two limits are one number.
 */
export const PLUGIN_CALL_DEADLINE_MS = 30_000;

/** The runtime's timers, read off `globalThis`: this package names no platform (ADR 0010). */
const timers = globalThis as unknown as {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
};

export interface IsolatedPluginOptions {
  readonly name: string;
  /** Handed to `tryActivate` as the document it was; the host validates it there. */
  readonly manifest: unknown;
  readonly channel: PluginChannel;
  /** The plugin's slice of the configuration, raw. */
  readonly config?: unknown;
  /** Where the plugin's `host.log` lines go. */
  readonly log?: Logger;
  readonly onCrash?: (reason: string) => void;
  /** The network and secrets behind `host.fetch` and `host.credentials`, if this host has any. */
  readonly capabilities?: HostCapabilities;
  /** One call's deadline: {@link PLUGIN_CALL_DEADLINE_MS} unless a test needs to wait less. */
  readonly deadlineMs?: number;
  /**
   * Activation's, starting the process included; the same default. Apart from a call's so a
   * test can shorten one without racing a thread's start-up against it.
   */
  readonly activationDeadlineMs?: number;
}

export interface IsolatedPlugin {
  /** Activate it through `tryActivate`, into as many hosts as there are tasks. */
  readonly plugin: Plugin;
  /** The reason, once the process has crashed. */
  crashed(): string | undefined;
  close(): Promise<void>;
}

interface Waiting {
  readonly spec: CallableSpec;
  readonly timer: unknown;
  resolve(value: unknown): void;
}

interface Replayed {
  readonly point: string;
  readonly spec: PointSpec;
  readonly contribution: Record<string, unknown>;
}

const NO_LOG: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function failure(name: string, problem: string): Diagnostics {
  return [diagnostic('E_PLUGIN_ACTIVATE', { plugin: name, problem })];
}

export function connectIsolatedPlugin(
  options: IsolatedPluginOptions,
): Promise<Result<IsolatedPlugin, Diagnostics>> {
  const { name, channel } = options;
  const log = options.log ?? NO_LOG;
  const waiting = new Map<number, Waiting>();
  /** Registrations by `point/id`; `withdrawn` removes one, and live hosts drop it too. */
  const registrations = new Map<string, Replayed>();
  const live = new Map<string, Set<Disposable>>();
  let nextCall = 0;
  let crash: string | undefined;
  let closed = false;
  const deadlineMs = options.deadlineMs ?? PLUGIN_CALL_DEADLINE_MS;
  const activationDeadlineMs = options.activationDeadlineMs ?? PLUGIN_CALL_DEADLINE_MS;
  const inSeconds = (ms: number): number => Math.round(ms / 100) / 10;
  const seconds = inSeconds(deadlineMs);
  // The permissions of the manifest as the host validated it. A manifest that does not
  // validate grants nothing, and `tryActivate` refuses the plugin anyway.
  const validated = validatePluginManifest(options.manifest);
  const permissions = validated.ok ? validated.value.permissions : [];
  const capabilities = checkedCapabilities(name, permissions, options.capabilities);

  return new Promise((settle) => {
    let activated = false;
    let greeted = false;

    const activation = timers.setTimeout(() => {
      if (activated) return;
      refuse(
        failure(
          name,
          `it did not finish activating within ${String(inSeconds(activationDeadlineMs))} s`,
        ),
      );
    }, activationDeadlineMs);

    const refuse = (problems: Diagnostics): void => {
      timers.clearTimeout(activation);
      activated = true;
      void channel.close();
      channel.keepAlive(false);
      settle(err(problems));
    };

    function keepAlive(): void {
      channel.keepAlive(!activated || waiting.size > 0);
    }

    function answerEveryWaiting(problems: Diagnostics): void {
      for (const [id, call] of waiting) {
        waiting.delete(id);
        timers.clearTimeout(call.timer);
        call.resolve(call.spec.failed(problems));
      }
      keepAlive();
    }

    /** Past the deadline: every waiting call is answered, and the process is ended. */
    function expire(): void {
      if (crash !== undefined || closed) return;
      const reason = `it did not answer within ${String(seconds)} s`;
      crash = reason;
      answerEveryWaiting([diagnostic('E_PLUGIN_TIMEOUT', { plugin: name, seconds })]);
      // `close`, so the exit is not reported a second time as a crash of its own.
      void channel.close();
      options.onCrash?.(reason);
    }

    function call(spec: CallableSpec, handle: number, args: readonly unknown[]): Promise<unknown> {
      if (crash !== undefined) {
        return Promise.resolve(
          spec.failed([diagnostic('E_PLUGIN_CRASHED', { plugin: name, reason: crash })]),
        );
      }
      const id = nextCall++;
      return new Promise((resolve) => {
        waiting.set(id, { spec, resolve, timer: timers.setTimeout(expire, deadlineMs) });
        keepAlive();
        channel.send({ protocol: RPC_PROTOCOL_VERSION, type: 'call', id, handle, args: [...args] });
      });
    }

    /** The data as the host validated it, and each handle as a function that calls back. */
    function proxyOf(registration: Registration): Replayed | string {
      const spec = pointSpecOf(registration.point);
      if (spec === undefined) {
        return `it registered into '${registration.point}', which an isolated plugin cannot reach`;
      }
      const handles = z.strictObject(
        Object.fromEntries(
          Object.entries(spec.callables).map(([key, callable]) => [
            key,
            callable.optional === true ? callHandleSchema.optional() : callHandleSchema,
          ]),
        ),
      );
      const shape = spec.data.extend(handles.shape);
      const parsed = shape.safeParse(registration.contribution);
      if (!parsed.success) {
        return `its '${registration.point}' contribution does not match: ${describeIssues(parsed.error)}`;
      }

      const contribution: Record<string, unknown> = { ...parsed.data };
      for (const [key, callable] of Object.entries(spec.callables)) {
        const handle = parsed.data[key] as { $call: number } | undefined;
        // An optional function the plugin did not register stays absent, as it is in-process.
        if (handle === undefined) continue;
        const { $call } = handle;
        contribution[key] = (...args: unknown[]): Promise<unknown> =>
          call(callable, $call, callable.send(args));
      }
      return { point: registration.point, spec, contribution };
    }

    /**
     * `host.fetch` and `host.credentials`, answered here — on the host's side, against the
     * manifest the host validated, so a plugin cannot talk its way past the check.
     */
    async function serve(message: Extract<GuestMessage, { type: 'request' }>): Promise<void> {
      const reply = (
        answer: { ok: true; value: unknown } | { ok: false; message: string; diagnostic?: unknown },
      ): void => {
        if (crash !== undefined || closed) return;
        channel.send({
          protocol: RPC_PROTOCOL_VERSION,
          type: 'response',
          id: message.id,
          ...answer,
        } as never);
      };
      try {
        if (message.capability === 'fetch') {
          const args = fetchArgsSchema.safeParse(message.args);
          if (!args.success)
            throw new TypeError(`host.fetch was given ${describeIssues(args.error)}`);
          // Zod types an optional key as `?: T | undefined`; a cloned message holds no
          // `undefined`, so the two are one here.
          const [url, init] = args.data as [string, HostFetchInit | undefined];
          reply({ ok: true, value: await capabilities.fetch(url, init) });
        } else {
          const args = credentialsArgsSchema.safeParse(message.args);
          if (!args.success)
            throw new TypeError(`host.credentials was given ${describeIssues(args.error)}`);
          reply({ ok: true, value: await capabilities.credentials(args.data[0]) });
        }
      } catch (cause) {
        reply(
          cause instanceof PluginCapabilityError
            ? { ok: false, message: cause.message, diagnostic: cause.diagnostic }
            : { ok: false, message: cause instanceof Error ? cause.message : String(cause) },
        );
      }
    }

    function receive(message: GuestMessage): void {
      switch (message.type) {
        case 'activated': {
          if (activated) return;
          for (const registration of message.registrations) {
            const proxy = proxyOf(registration);
            if (typeof proxy === 'string') {
              refuse([diagnostic('E_PLUGIN_ACTIVATE', { plugin: name, problem: proxy })]);
              return;
            }
            registrations.set(`${proxy.point}/${String(proxy.contribution['id'])}`, proxy);
          }
          activated = true;
          timers.clearTimeout(activation);
          keepAlive();
          settle(ok(isolated));
          return;
        }
        case 'failed':
          if (!activated) refuse(failure(name, message.problem));
          return;
        case 'result':
        case 'thrown': {
          const pending = waiting.get(message.id);
          if (pending === undefined) return;
          waiting.delete(message.id);
          timers.clearTimeout(pending.timer);
          if (message.type === 'thrown') {
            pending.resolve(
              pending.spec.failed([
                diagnostic('E_PLUGIN_CALL', { plugin: name, problem: message.problem }),
              ]),
            );
          } else {
            const checked = pending.spec.result.safeParse(message.value);
            pending.resolve(
              checked.success
                ? checked.data
                : pending.spec.failed([
                    diagnostic('E_PLUGIN_PROTOCOL', {
                      plugin: name,
                      problem: `its answer does not match: ${describeIssues(checked.error)}`,
                    }),
                  ]),
            );
          }
          keepAlive();
          return;
        }
        case 'log':
          log[message.level](`[${name}] ${message.message}`, message.detail);
          return;
        case 'request':
          void serve(message);
          return;
        case 'withdrawn': {
          const key = `${message.point}/${message.id}`;
          registrations.delete(key);
          for (const disposable of live.get(key) ?? []) disposable.dispose();
          live.delete(key);
          return;
        }
      }
    }

    channel.onMessage((raw) => {
      if (!greeted) {
        const hello = helloMessageSchema.safeParse(raw);
        if (!hello.success) {
          refuse([
            diagnostic('E_PLUGIN_PROTOCOL', {
              plugin: name,
              problem: 'its first message was not hello',
            }),
          ]);
          return;
        }
        if (hello.data.protocol !== RPC_PROTOCOL_VERSION) {
          refuse(
            failure(
              name,
              `its process speaks protocol ${String(hello.data.protocol)} and this host speaks ` +
                `${String(RPC_PROTOCOL_VERSION)}`,
            ),
          );
          return;
        }
        greeted = true;
        channel.send({
          protocol: RPC_PROTOCOL_VERSION,
          type: 'activate',
          plugin: name,
          config: options.config,
        });
        return;
      }

      const parsed = guestMessageSchema.safeParse(raw);
      if (!parsed.success) {
        // Said, and not acted on. A message the host cannot read is dropped whole, and a call
        // it was meant to answer answers when the process ends or never.
        log.error(`[${name}] ${describeIssues(parsed.error)}`);
        if (!activated) {
          refuse([
            diagnostic('E_PLUGIN_PROTOCOL', {
              plugin: name,
              problem: describeIssues(parsed.error),
            }),
          ]);
        }
        return;
      }
      receive(parsed.data);
    });

    channel.onExit((reason) => {
      if (closed || crash !== undefined) return;
      crash = reason;
      if (!activated) {
        refuse(failure(name, `its process exited during activation: ${reason}`));
        return;
      }
      answerEveryWaiting([diagnostic('E_PLUGIN_CRASHED', { plugin: name, reason })]);
      options.onCrash?.(reason);
    });

    const plugin: Plugin = {
      id: name,
      manifest: options.manifest,
      activate(host: PluginHost): Disposable {
        const mine: { key: string; disposable: Disposable }[] = [];
        for (const [key, { spec, contribution }] of registrations) {
          const register = host[spec.method] as (value: unknown) => Disposable;
          const disposable = register(contribution);
          mine.push({ key, disposable });
          live.set(key, (live.get(key) ?? new Set()).add(disposable));
        }

        // The host this plugin is activated in is the one whose events it hears.
        const forwarded = (['registered', 'disposed'] as const).map((event) =>
          host.events.on(event, (payload) => {
            if (crash !== undefined || closed) return;
            channel.send({ protocol: RPC_PROTOCOL_VERSION, type: 'event', event, payload });
          }),
        );

        return {
          dispose: () => {
            for (const { key, disposable } of mine) {
              disposable.dispose();
              live.get(key)?.delete(disposable);
            }
            for (const subscription of forwarded) subscription.dispose();
          },
        };
      },
    };

    const isolated: IsolatedPlugin = {
      plugin,
      crashed: () => crash,
      async close() {
        if (closed) return;
        closed = true;
        answerEveryWaiting([
          diagnostic('E_PLUGIN_CRASHED', { plugin: name, reason: 'the host closed it' }),
        ]);
        channel.keepAlive(false);
        await channel.close();
      },
    };

    keepAlive();
  });
}
