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
    const bridge = createBridge(() => Promise.resolve({}));

    expect(Object.keys(bridge).sort()).toEqual([...IPC_CHANNEL_NAMES].sort());
  });

  it('never puts a bad request on the wire', () => {
    const invoke = vi.fn(() => Promise.resolve({}));
    const bridge = createBridge(invoke);

    expect(() => bridge['credentials:set']({ account: 42, secret: 'x' } as never)).toThrow(
      IpcContractError,
    );
    // The point: main was not woken at all. Without this side the message would travel, be
    // parsed there, and come back as a rejection — same outcome, one process boundary later.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('throws synchronously, so the stack is the one that built the request', () => {
    const bridge = createBridge(() => Promise.resolve({}));

    // A rejected promise would carry a stack from inside the IPC machinery instead. `toThrow`
    // passing at all is the assertion — a promise rejection would not be caught here.
    expect(() => bridge['credentials:get']({ account: '' } as never)).toThrow(IpcContractError);
  });

  it('passes a good request straight through, unchanged', async () => {
    const invoke = vi.fn(() => Promise.resolve({ stored: true }));
    const bridge = createBridge(invoke);

    await bridge['credentials:set']({ account: 'jira', secret: 'token' });

    expect(invoke).toHaveBeenCalledWith('credentials:set', { account: 'jira', secret: 'token' });
  });

  it('hands back whatever main answered', async () => {
    const bridge = createBridge(() => Promise.resolve({ secret: 'token' }));

    expect(await bridge['credentials:get']({ account: 'jira' })).toEqual({ secret: 'token' });
  });
});
