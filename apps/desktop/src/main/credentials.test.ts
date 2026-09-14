import { describe, expect, it } from 'vitest';

import {
  type CredentialStore,
  type SafeStorage,
  EncryptionUnavailableError,
  createCredentials,
} from './credentials.js';

/**
 * What a test of a keychain wrapper can honestly assert.
 *
 * Not the cryptography — that belongs to the operating system, and a fake that "encrypted"
 * by reversing a string would only prove the fake works. What is worth pinning is the
 * routing: that plaintext never reaches the store, that a refused keychain stops the write
 * instead of degrading it, and that an account nobody stored reads back as `null` rather
 * than as an error.
 */

const memoryStore = (): CredentialStore & { readonly written: Map<string, Buffer> } => {
  const written = new Map<string, Buffer>();
  return {
    written,
    read: (account) => Promise.resolve(written.get(account)),
    write: (account, ciphertext) => {
      written.set(account, ciphertext);
      return Promise.resolve();
    },
    delete: (account) => Promise.resolve(written.delete(account)),
  };
};

/** Stands in for the OS. `rot` is not encryption and is not pretending to be. */
const fakeEncryption = (available = true): SafeStorage => ({
  isEncryptionAvailable: () => available,
  encryptString: (plainText) => Buffer.from(`sealed:${plainText}`, 'utf8'),
  decryptString: (encrypted) => encrypted.toString('utf8').replace(/^sealed:/u, ''),
});

describe('credentials', () => {
  it('stores what the keychain gave back, never the plaintext', () => {
    const store = memoryStore();
    const credentials = createCredentials({ store, encryption: fakeEncryption() });

    return credentials.set('jira', 'super-secret').then(() => {
      const stored = store.written.get('jira');

      expect(stored).toBeInstanceOf(Buffer);
      expect(stored?.toString('utf8')).not.toBe('super-secret');
      expect(stored?.toString('utf8')).toBe('sealed:super-secret');
    });
  });

  it('round-trips a secret through the store', async () => {
    const credentials = createCredentials({ store: memoryStore(), encryption: fakeEncryption() });

    await credentials.set('drive', 'token-1');

    expect(await credentials.get('drive')).toBe('token-1');
  });

  it('answers null for an account nothing was stored under', async () => {
    const credentials = createCredentials({ store: memoryStore(), encryption: fakeEncryption() });

    // The normal first run, not a failure.
    expect(await credentials.get('never-set')).toBeNull();
  });

  it('forgets one, and says so only when there was one', async () => {
    const credentials = createCredentials({ store: memoryStore(), encryption: fakeEncryption() });
    await credentials.set('jira', 'token');

    expect(await credentials.delete('jira')).toBe(true);
    expect(await credentials.delete('jira')).toBe(false);
    expect(await credentials.get('jira')).toBeNull();
  });
});

/**
 * The failure this module exists to make impossible.
 *
 * A freshly installed Linux with no session keyring answers `false`, and the tempting
 * behaviour — write the token in the clear and carry on — is the one that must not happen.
 */
describe('when the operating system offers no key', () => {
  it('refuses to store, and writes nothing at all', async () => {
    const store = memoryStore();
    const credentials = createCredentials({ store, encryption: fakeEncryption(false) });

    await expect(credentials.set('jira', 'token')).rejects.toBeInstanceOf(
      EncryptionUnavailableError,
    );
    expect(store.written.size).toBe(0);
  });

  it('refuses to read a secret it cannot decrypt, rather than answering null', async () => {
    const store = memoryStore();
    await store.write('jira', Buffer.from('sealed:token', 'utf8'));
    const credentials = createCredentials({ store, encryption: fakeEncryption(false) });

    // `null` would read as "nothing stored" and send a caller off to ask for the password
    // again, when the truth is that the keychain is locked.
    await expect(credentials.get('jira')).rejects.toBeInstanceOf(EncryptionUnavailableError);
  });

  it('says what happened in a sentence a person can act on', async () => {
    const credentials = createCredentials({
      store: memoryStore(),
      encryption: fakeEncryption(false),
    });

    await expect(credentials.set('jira', 'token')).rejects.toThrow(/keyring/u);
  });
});
