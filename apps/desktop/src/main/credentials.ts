/**
 * Credentials, through the OS keychain and nothing else (ADR 0001, `CLAUDE.md`).
 *
 * `safeStorage` encrypts with a key the operating system holds — Keychain on macOS, DPAPI
 * on Windows, the session keyring on Linux — so what this writes to disk is ciphertext only
 * the logged-in user's session can read. That is the whole reason a token never reaches the
 * renderer: `safeStorage` is a main-process API, and a renderer with `nodeIntegration:
 * false` could not call it even if a bug tried to.
 *
 * What is stored is the *ciphertext*, keyed by account name. Where it is stored is the
 * caller's decision, taken through the `CredentialStore` port below — main binds it to a
 * file under `app.getPath('userData')`, and a test binds it to a map. Encryption does not
 * change with the destination, so it does not live with the destination.
 */

/** Where the ciphertext goes. Bytes in, bytes out; this port never sees a plaintext. */
export interface CredentialStore {
  read(account: string): Promise<Buffer | undefined>;
  write(account: string, ciphertext: Buffer): Promise<void>;
  delete(account: string): Promise<boolean>;
}

export interface CredentialsOptions {
  readonly store: CredentialStore;
  /**
   * The encryption, taken as an argument rather than imported.
   *
   * This module names no Electron API, and that is what lets `pnpm check` run it: importing
   * `electron` outside a running Electron gives back a path string, so a top-level
   * `import { safeStorage }` would be `undefined` in every test and in the CLI. The seam is
   * declared here and bound in the composition root, which is the same move the rest of the
   * repo makes for a browser or a disk (ADR 0010) — and it beats mocking the module, which
   * would leave the test asserting its own fake.
   *
   * What a test can then check is the *routing*: that a refused keychain is reported rather
   * than silently storing plaintext. The cryptography stays with the platform that owns it.
   */
  readonly encryption: SafeStorage;
}

/** The slice of Electron's `safeStorage` this uses, named so a test can stand in for it. */
export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Raised when the OS has no key to encrypt with.
 *
 * A real condition rather than a theoretical one: a freshly installed Linux with no
 * keyring, or a session started before the keyring unlocked, answers `false` here. Throwing
 * is the point — the alternative is writing the token in the clear and telling nobody,
 * which is the failure mode this whole module exists to make impossible.
 */
export class EncryptionUnavailableError extends Error {
  constructor() {
    super(
      'the operating system offered no encryption key, so nothing was stored — ' +
        'on Linux this usually means the session keyring is locked or absent',
    );
    this.name = 'EncryptionUnavailableError';
  }
}

export interface Credentials {
  set(account: string, secret: string): Promise<void>;
  get(account: string): Promise<string | null>;
  delete(account: string): Promise<boolean>;
}

export function createCredentials(options: CredentialsOptions): Credentials {
  const { encryption, store } = options;

  const requireEncryption = (): SafeStorage => {
    if (!encryption.isEncryptionAvailable()) throw new EncryptionUnavailableError();
    return encryption;
  };

  return {
    set: async (account, secret) => {
      await store.write(account, requireEncryption().encryptString(secret));
    },

    get: async (account) => {
      const ciphertext = await store.read(account);
      if (ciphertext === undefined) return null;
      return requireEncryption().decryptString(ciphertext);
    },

    delete: (account) => store.delete(account),
  };
}
