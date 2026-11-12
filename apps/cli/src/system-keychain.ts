import type { CliSigninSecrets } from '@tyto/command-line';

/**
 * The system keychain, for the sign-ins `tyto signin` keeps (ADR 0194): Credential Manager on
 * Windows, Keychain on macOS and the Secret Service on Linux, through `@napi-rs/keyring`.
 *
 * **The CLI's own entries, never the desktop's.** Each account (`signin:<plugin>:<id>`,
 * `signin-client:<plugin>:<id>`) is one entry under {@link KEYCHAIN_SERVICE}; the desktop keeps
 * its sign-ins in its own `safeStorage` files, which this never opens.
 *
 * **No plaintext fallback.** A keychain that refuses — a Linux session with no Secret Service,
 * measured in a headless WSL — is an error the command reports, never a file written instead.
 */

/** The service name every entry is filed under, so a person can find Tyto's in the OS's tool. */
export const KEYCHAIN_SERVICE = 'Tyto CLI';

/**
 * The largest value stored, in UTF-8 bytes: Windows' Credential Manager holds 2,560 bytes,
 * measured with this module's `setSecret` (2,560 stored, 2,561 refused). The same ceiling on
 * every system, so a sign-in that works on one works on all. A sign-in record measured 86
 * bytes; a client typed in full, two 512-character values, about 1,060.
 */
export const KEYCHAIN_VALUE_LIMIT_BYTES = 2560;

/** The slice of `@napi-rs/keyring`'s `AsyncEntry` this uses, so a test stands in for it. */
export interface KeychainEntry {
  setSecret(secret: Uint8Array): Promise<void>;
  getSecret(): Promise<readonly number[] | null>;
  deleteCredential(): Promise<boolean>;
}

/** Opens the entry of one account. */
export type OpenKeychainEntry = (account: string) => Promise<KeychainEntry>;

/**
 * The real keychain, loaded on first use: a command that never signs in never loads the native
 * module, so a platform without its binary still renders.
 */
export const openSystemKeychainEntry: OpenKeychainEntry = async (account) => {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  return new AsyncEntry(KEYCHAIN_SERVICE, account);
};

function refused(action: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(`the system keychain refused to ${action}: ${reason}`, { cause });
}

export function systemKeychain(
  open: OpenKeychainEntry = openSystemKeychainEntry,
): CliSigninSecrets {
  const read = async (account: string): Promise<string | null> => {
    let bytes: readonly number[] | null;
    try {
      bytes = await (await open(account)).getSecret();
    } catch (cause) {
      throw refused('read a sign-in', cause);
    }
    return bytes === null ? null : new TextDecoder().decode(Uint8Array.from(bytes));
  };
  return {
    get: read,
    has: async (account) => (await read(account)) !== null,
    async set(account, secret) {
      const bytes = new TextEncoder().encode(secret);
      if (bytes.length > KEYCHAIN_VALUE_LIMIT_BYTES) {
        throw new Error(
          `the value is ${bytes.length} bytes, and the system keychain keeps at most ` +
            `${KEYCHAIN_VALUE_LIMIT_BYTES} (ADR 0194)`,
        );
      }
      try {
        await (await open(account)).setSecret(bytes);
      } catch (cause) {
        throw refused('store a sign-in', cause);
      }
    },
    async delete(account) {
      try {
        return await (await open(account)).deleteCredential();
      } catch (cause) {
        throw refused('forget a sign-in', cause);
      }
    },
  };
}
