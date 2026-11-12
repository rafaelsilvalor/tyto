import { describe, expect, it } from 'vitest';

import { browserCommand } from './system-browser.js';
import {
  KEYCHAIN_VALUE_LIMIT_BYTES,
  type KeychainEntry,
  type OpenKeychainEntry,
  systemKeychain,
} from './system-keychain.js';

/**
 * The keychain adapter through its typed seam (ADR 0194): no test writes the real keychain. The
 * module's own behaviour was measured once on Windows, in a namespace of its own and cleaned up:
 * `setSecret` holds 2,560 bytes and refuses 2,561, `getSecret` answers `null` for an account
 * with nothing, `deleteCredential` answers `false` for one.
 */

function fakeKeychain(): {
  readonly open: OpenKeychainEntry;
  readonly stored: Map<string, Uint8Array>;
  readonly opened: string[];
} {
  const stored = new Map<string, Uint8Array>();
  const opened: string[] = [];
  const open: OpenKeychainEntry = (account) => {
    opened.push(account);
    const entry: KeychainEntry = {
      setSecret: (secret) => {
        stored.set(account, secret);
        return Promise.resolve();
      },
      getSecret: () => {
        const bytes = stored.get(account);
        return Promise.resolve(bytes === undefined ? null : [...bytes]);
      },
      deleteCredential: () => Promise.resolve(stored.delete(account)),
    };
    return Promise.resolve(entry);
  };
  return { open, stored, opened };
}

describe('systemKeychain', () => {
  it('stores UTF-8 bytes under the account and reads the same text back', async () => {
    const { open, stored, opened } = fakeKeychain();
    const keychain = systemKeychain(open);

    await keychain.set('signin:drive-plugin:drive', 'conta-ção ✓');

    expect(opened).toEqual(['signin:drive-plugin:drive']);
    expect(stored.get('signin:drive-plugin:drive')).toEqual(
      new TextEncoder().encode('conta-ção ✓'),
    );
    expect(await keychain.get('signin:drive-plugin:drive')).toBe('conta-ção ✓');
    expect(await keychain.has('signin:drive-plugin:drive')).toBe(true);
  });

  it('answers null and false for an account with nothing', async () => {
    const keychain = systemKeychain(fakeKeychain().open);

    expect(await keychain.get('signin:none:none')).toBeNull();
    expect(await keychain.has('signin:none:none')).toBe(false);
    expect(await keychain.delete('signin:none:none')).toBe(false);
  });

  it('forgets an account', async () => {
    const { open, stored } = fakeKeychain();
    const keychain = systemKeychain(open);
    await keychain.set('signin:a:b', 'value');

    expect(await keychain.delete('signin:a:b')).toBe(true);
    expect(stored.size).toBe(0);
  });

  it('refuses a value over the ceiling in bytes, before the keychain is asked', async () => {
    const { open, opened } = fakeKeychain();
    const keychain = systemKeychain(open);

    // At the ceiling: stored whole, and read back whole.
    await keychain.set('signin:a:b', 'x'.repeat(KEYCHAIN_VALUE_LIMIT_BYTES));
    expect(await keychain.get('signin:a:b')).toHaveLength(KEYCHAIN_VALUE_LIMIT_BYTES);
    // One byte past it: refused by name, nothing stored, never cut to fit.
    await expect(
      keychain.set('signin:a:c', 'x'.repeat(KEYCHAIN_VALUE_LIMIT_BYTES + 1)),
    ).rejects.toThrow(
      'the value is 2561 bytes, and the system keychain keeps at most 2560 (ADR 0194)',
    );
    // Counted in bytes: 1,281 two-byte characters are over, though far fewer characters.
    await expect(keychain.set('signin:a:d', 'ç'.repeat(1281))).rejects.toThrow('2562 bytes');
    expect(opened).toEqual(['signin:a:b', 'signin:a:b']);
    expect(await keychain.get('signin:a:c')).toBeNull();
  });

  it('names the keychain when it refuses, as a Linux session with no Secret Service does', async () => {
    const keychain = systemKeychain(() =>
      Promise.resolve({
        setSecret: () => Promise.reject(new Error('The name is not activatable')),
        getSecret: () => Promise.reject(new Error('The name is not activatable')),
        deleteCredential: () => Promise.reject(new Error('The name is not activatable')),
      }),
    );

    await expect(keychain.get('signin:a:b')).rejects.toThrow(
      'the system keychain refused to read a sign-in: The name is not activatable',
    );
    await expect(keychain.set('signin:a:b', 'v')).rejects.toThrow(
      'the system keychain refused to store a sign-in',
    );
  });
});

describe('browserCommand', () => {
  const url = 'https://auth.example.test/authorize?client_id=a&state=b';

  it('hands the URL whole to a program, never to a shell that would split it at &', () => {
    expect(browserCommand(url, 'win32')).toEqual({
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    });
    expect(browserCommand(url, 'darwin')).toEqual({ command: 'open', args: [url] });
    expect(browserCommand(url, 'linux')).toEqual({ command: 'xdg-open', args: [url] });
  });
});
