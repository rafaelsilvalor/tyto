import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNEL_NAMES, IpcContractError } from '../../shared/ipc.js';
import { type Credentials } from './credentials.js';
import { createHandlers, guard, registerIpcHandlers } from './ipc.js';

/**
 * The wiring, without Electron.
 *
 * `ipc.ts` names no Electron value — only the `IpcMain` type, which is erased — so the
 * whole of what a message goes through can be driven here: the contract on the way in, the
 * handler, and the contract on the way out. What is left for the end-to-end suite is the
 * transport and the window flags, which are the only parts a real launch can tell you about.
 */

const credentials = (): Credentials => {
  const stored = new Map<string, string>();
  return {
    set: (account, secret) => {
      stored.set(account, secret);
      return Promise.resolve();
    },
    get: (account) => Promise.resolve(stored.get(account) ?? null),
    delete: (account) => Promise.resolve(stored.delete(account)),
  };
};

/**
 * A preview that compiles nothing.
 *
 * `preview.test.ts` drives the real one against the real pack; what this file is about is
 * the registration and the contract, and those are the same whichever service answers.
 */
const preview = () => ({
  preview: (brief: string) =>
    Promise.resolve({
      frames:
        brief.trim() === ''
          ? []
          : [{ artwork: 'a1', format: 'feed', width: 1080, height: 1080, html: '<!doctype html>' }],
      diagnostics: [],
    }),
});

const dependencies = () => ({
  credentials: credentials(),
  info: () => ({ version: '0.1.0', platform: 'linux', locale: 'pt-BR', templates: ['promo'] }),
  preview: preview(),
});

describe('registerIpcHandlers', () => {
  it('binds every channel the contract declares, and nothing else', () => {
    const handle = vi.fn();
    registerIpcHandlers({ handle } as never, dependencies());

    const bound = handle.mock.calls.map((call) => call[0] as string);

    // A channel in the table with no handler here is already a type error; this is the
    // other direction — that registration actually walked the whole table.
    expect(bound.sort()).toEqual([...IPC_CHANNEL_NAMES].sort());
  });

  it('uses handle, so a rejection reaches the caller', async () => {
    // `on` would be fire-and-forget: a refused request would leave the renderer waiting
    // forever instead of catching. The contract only helps if the refusal travels.
    const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
    registerIpcHandlers(
      { handle: (name: string, handler: never) => handlers.set(name, handler) } as never,
      dependencies(),
    );

    await expect(handlers.get('credentials:get')?.(null, { account: '' })).rejects.toBeInstanceOf(
      IpcContractError,
    );
  });
});

describe('the handlers', () => {
  it('round-trips a credential through the channels that own it', async () => {
    const handlers = createHandlers(dependencies());

    expect(await handlers['credentials:set']({ account: 'jira', secret: 'token' })).toEqual({
      stored: true,
    });
    expect(await handlers['credentials:get']({ account: 'jira' })).toEqual({ secret: 'token' });
    expect(await handlers['credentials:delete']({ account: 'jira' })).toEqual({ deleted: true });
    expect(await handlers['credentials:get']({ account: 'jira' })).toEqual({ secret: null });
  });

  it('answers app:info from what the composition root injected', async () => {
    const handlers = createHandlers(dependencies());

    expect(await handlers['app:info']({})).toEqual({
      version: '0.1.0',
      platform: 'linux',
      locale: 'pt-BR',
      templates: ['promo'],
    });
  });
});

describe('guard', () => {
  it('refuses a request that does not match, before the handler runs', async () => {
    const handler = vi.fn();
    const guarded = guard('credentials:get', handler as never);

    await expect(guarded({ account: 42 })).rejects.toBeInstanceOf(IpcContractError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a response that does not match, which is main’s own bug', async () => {
    const guarded = guard('app:info', (() =>
      Promise.resolve({ version: '1', platform: 'linux' })) as never);

    await expect(guarded({})).rejects.toThrow(/response does not match/u);
  });

  it('hands the handler the parsed value, not the raw one', async () => {
    const handler = vi.fn(() => Promise.resolve({ secret: null }));
    const guarded = guard('credentials:get', handler as never);

    await guarded({ account: '  jira  ', extra: 'dropped' });

    // Trimmed by the schema and stripped of the key nobody declared: the handler sees the
    // contract's shape, so it never has to defend itself.
    expect(handler).toHaveBeenCalledWith({ account: 'jira' });
  });
});
