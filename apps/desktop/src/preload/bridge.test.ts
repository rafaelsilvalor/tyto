import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNEL_NAMES, IpcContractError } from '../../shared/ipc.js';
import { createBridge } from './bridge.js';

/**
 * What the renderer's half of the contract is for.
 *
 * Main validates the same requests, so a test that only checked "a bad payload is refused"
 * would pass with this side deleted — measured, by deleting it and watching the end-to-end
 * suite stay green. What only this side can do is refuse **before the message is sent**, and
 * that is what these assert.
 */

describe('createBridge', () => {
  it('offers exactly the channels the contract declares', () => {
    const bridge = createBridge(
      () => Promise.resolve({}),
      () => () => {},
    );

    // `on` is the one key that is not a channel: it is the receive direction (ADR 0029), and
    // it is asserted here rather than left out because this is the only place in the repo
    // that enumerates the bridge object at all.
    expect(Object.keys(bridge).sort()).toEqual([...IPC_CHANNEL_NAMES, 'on'].sort());
  });

  it('never puts a bad request on the wire', () => {
    const invoke = vi.fn(() => Promise.resolve({}));
    const bridge = createBridge(invoke, () => () => {});

    expect(() => bridge['credentials:set']({ account: 42, secret: 'x' } as never)).toThrow(
      IpcContractError,
    );
    // The point: main was not woken at all. Without this side the message would travel, be
    // parsed there, and come back as a rejection — same outcome, one process boundary later.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('throws synchronously, so the stack is the one that built the request', () => {
    const bridge = createBridge(
      () => Promise.resolve({}),
      () => () => {},
    );

    // A rejected promise would carry a stack from inside the IPC machinery instead. `toThrow`
    // passing at all is the assertion — a promise rejection would not be caught here.
    expect(() => bridge['credentials:get']({ account: '' } as never)).toThrow(IpcContractError);
  });

  it('passes a good request straight through, unchanged', async () => {
    const invoke = vi.fn(() => Promise.resolve({ stored: true }));
    const bridge = createBridge(invoke, () => () => {});

    await bridge['credentials:set']({ account: 'jira', secret: 'token' });

    expect(invoke).toHaveBeenCalledWith('credentials:set', { account: 'jira', secret: 'token' });
  });

  it('hands back whatever main answered', async () => {
    const bridge = createBridge(
      () => Promise.resolve({ secret: 'token' }),
      () => () => {},
    );

    expect(await bridge['credentials:get']({ account: 'jira' })).toEqual({ secret: 'token' });
  });
});

/**
 * The receive direction (ADR 0029), which nothing in this repo exercised before TYTO-123.
 *
 * Same argument as the request half, with the roles swapped: a push that does not fit the
 * contract is **main's** bug, and this is the only place that can refuse it before a listener
 * has already acted on it.
 */
describe('createBridge.on', () => {
  it('refuses an event name the contract does not declare, synchronously', () => {
    const subscribe = vi.fn(() => () => {});
    const bridge = createBridge(() => Promise.resolve({}), subscribe);

    // A misspelled name would otherwise be a listener that simply never fires — which reads
    // as "main never sent it" and is the hardest kind of wiring bug to see.
    expect(() => bridge.on('app:exit-request' as never, () => {})).toThrow(IpcContractError);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('parses a push before the listener sees it', () => {
    let deliver: ((payload: unknown) => void) | undefined;
    const bridge = createBridge(
      () => Promise.resolve({}),
      (_event, listen) => {
        deliver = listen;
        return () => {};
      },
    );
    const listener = vi.fn();
    bridge.on('app:exit-requested', listener);

    deliver?.({ askId: 7 });

    expect(listener).toHaveBeenCalledWith({ askId: 7 });
  });

  it('never lets a malformed push reach the listener', () => {
    let deliver: ((payload: unknown) => void) | undefined;
    const bridge = createBridge(
      () => Promise.resolve({}),
      (_event, listen) => {
        deliver = listen;
        return () => {};
      },
    );
    const listener = vi.fn();
    bridge.on('app:exit-requested', listener);

    expect(() => deliver?.({})).toThrow(IpcContractError);
    expect(listener).not.toHaveBeenCalled();
  });

  it('hands back the function that unsubscribes', () => {
    const remove = vi.fn();
    const bridge = createBridge(
      () => Promise.resolve({}),
      () => remove,
    );

    const off = bridge.on('app:exit-requested', () => {});
    off();

    // Returned rather than requiring the caller to keep the listener around to take it off
    // again — the only shape that does not make cleanup a second bookkeeping problem.
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
