import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

import type { Disposable, Logger, Plugin, PluginHost } from '../host.js';
import type { PluginChannel } from './channel.js';
import { type CallableSpec, type PointSpec, pointSpecOf } from './points.js';
import {
  type GuestMessage,
  RPC_PROTOCOL_VERSION,
  type Registration,
  callHandleSchema,
  describeIssues,
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
 */

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

  return new Promise((settle) => {
    let activated = false;
    let greeted = false;

    const refuse = (problems: Diagnostics): void => {
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
        call.resolve(call.spec.failed(problems));
      }
      keepAlive();
    }

    function call(spec: CallableSpec, handle: number, args: readonly unknown[]): Promise<unknown> {
      if (crash !== undefined) {
        return Promise.resolve(
          spec.failed([diagnostic('E_PLUGIN_CRASHED', { plugin: name, reason: crash })]),
        );
      }
      const id = nextCall++;
      return new Promise((resolve) => {
        waiting.set(id, { spec, resolve });
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
        Object.fromEntries(Object.keys(spec.callables).map((key) => [key, callHandleSchema])),
      );
      const shape = spec.data.extend(handles.shape);
      const parsed = shape.safeParse(registration.contribution);
      if (!parsed.success) {
        return `its '${registration.point}' contribution does not match: ${describeIssues(parsed.error)}`;
      }

      const contribution: Record<string, unknown> = { ...parsed.data };
      for (const [key, callable] of Object.entries(spec.callables)) {
        const { $call } = parsed.data[key] as { $call: number };
        contribution[key] = (...args: unknown[]): Promise<unknown> =>
          call(callable, $call, callable.send(args));
      }
      return { point: registration.point, spec, contribution };
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
