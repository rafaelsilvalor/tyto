import { describe, expect, it } from 'vitest';

import {
  type IpcChannelName,
  IPC_CHANNELS,
  IPC_CHANNEL_NAMES,
  IpcContractError,
  isIpcChannelName,
  parseIpc,
} from './ipc.js';

describe('the IPC contract', () => {
  it('names every channel exactly once, and nothing else', () => {
    expect([...IPC_CHANNEL_NAMES].sort()).toEqual([
      'app:info',
      'brief:preview',
      'credentials:delete',
      'credentials:get',
      'credentials:set',
      'file:open',
      'file:reopen',
      'file:save',
      'files:recent',
      'templates:list',
    ]);
    expect(new Set(IPC_CHANNEL_NAMES).size).toBe(IPC_CHANNEL_NAMES.length);
  });

  it('declares both directions for every channel', () => {
    // The table is what `registerIpcHandlers` and the preload both walk, so a channel with
    // half a contract would be a runtime `undefined.safeParse` on one side or the other.
    for (const name of IPC_CHANNEL_NAMES) {
      expect(IPC_CHANNELS[name].request, name).toBeDefined();
      expect(IPC_CHANNELS[name].response, name).toBeDefined();
    }
  });

  it('recognises its own channel names and refuses a made-up one', () => {
    expect(isIpcChannelName('app:info')).toBe(true);
    expect(isIpcChannelName('app:quit')).toBe(false);
    // Not a channel either, and the one a plain `in` check would have got wrong.
    expect(isIpcChannelName('toString')).toBe(false);
  });
});

/**
 * The acceptance criterion: *a round-trip IPC call with an invalid payload is rejected by
 * the Zod contract.* Driven here rather than through a window, because the contract is what
 * rejects and it needs neither process to do it.
 */
describe('a request that does not match', () => {
  it('is refused, with the channel and the field named', () => {
    expect(() => parseIpc('credentials:set', 'request', { account: 42, secret: 'x' })).toThrow(
      IpcContractError,
    );

    try {
      parseIpc('credentials:set', 'request', { account: 42, secret: 'x' });
      expect.unreachable('the contract accepted a number where a name goes');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as IpcContractError).channel).toBe('credentials:set');
      expect((error as IpcContractError).direction).toBe('request');
      // A reader has to be able to find the field without opening the schema.
      expect((error as Error).message).toContain('account');
    }
  });

  it('refuses a blank account, which would be a credential nobody can ask for again', () => {
    expect(() => parseIpc('credentials:get', 'request', { account: '   ' })).toThrow(
      IpcContractError,
    );
  });

  it('refuses a missing field as readily as a wrong one', () => {
    expect(() => parseIpc('credentials:set', 'request', { account: 'jira' })).toThrow(
      IpcContractError,
    );
  });

  it('accepts the shape the channel declares, and hands back the parsed value', () => {
    expect(parseIpc('credentials:set', 'request', { account: ' jira ', secret: 'token' })).toEqual({
      account: 'jira',
      secret: 'token',
    });
  });
});

describe('a response that does not match', () => {
  it('is refused too, and says it was the response', () => {
    // Main's bug, not the renderer's. Without this check the renderer would receive
    // `undefined` where its types promised a string, at some later line, with nothing
    // naming the channel.
    try {
      parseIpc('app:info', 'response', { version: '1.0.0', platform: 'win32', templates: [] });
      expect.unreachable('the contract accepted a response with no locale');
    } catch (error) {
      expect((error as IpcContractError).direction).toBe('response');
      expect((error as Error).message).toContain('locale');
    }
  });
});

describe('what the contract does not promise', () => {
  it('lets an unknown key through rather than refusing the message', () => {
    // Zod objects strip by default, and that is the right default across a version skew: a
    // renderer built against a newer contract sending one extra field should still work,
    // and the field it sent is simply not read.
    const parsed = parseIpc('credentials:get', 'request', {
      account: 'jira',
      unexpected: true,
    }) as Record<string, unknown>;

    expect(parsed).toEqual({ account: 'jira' });
  });

  it('checks every declared channel, not only the ones a test remembers', () => {
    // `{}` is a valid request for the two channels that ask the app about itself and an
    // invalid one for all three credential channels. Asserting it per channel from the
    // table means a channel added later is covered by this test the day it is added.
    const optional: readonly IpcChannelName[] = [
      'app:info',
      'templates:list',
      // E9.8. Both ask a question with no arguments: which file do you want, and what have
      // you opened lately. The paths are main's answer, never the renderer's question.
      'file:open',
      'files:recent',
    ];

    for (const name of IPC_CHANNEL_NAMES) {
      const accepts = IPC_CHANNELS[name].request.safeParse({}).success;
      expect(accepts, name).toBe(optional.includes(name));
    }
  });
});
