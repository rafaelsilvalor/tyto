import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { type CredentialStore } from './credentials.js';

/**
 * Ciphertext on disk, one file per account, under the app's own data folder.
 *
 * Files and not a database, for the same reason the rest of Tyto is files (ADR 0009): a
 * person can see what exists, delete one by hand, and back the folder up. The contents are
 * unreadable without the OS key, so "visible" costs nothing here.
 *
 * The account name is encoded rather than used raw. It comes from the renderer, and a name
 * with a `/` or a `..` in it would be a path this writes outside the folder it was given —
 * the one bug in a credential store that turns a typo into a write anywhere on the disk.
 * `encodeURIComponent` maps every separator to `%XX`, which is reversible and leaves the
 * ordinary names (`jira`, `drive`) legible in a folder listing.
 */
const CIPHERTEXT_EXTENSION = '.bin';

export function fileCredentialStore(directory: string): CredentialStore {
  const fileFor = (account: string): string =>
    join(directory, `${encodeURIComponent(account)}${CIPHERTEXT_EXTENSION}`);

  return {
    read: async (account) => {
      try {
        return await readFile(fileFor(account));
      } catch (error) {
        // Absent is not a failure: asking for a credential nobody stored is the normal
        // first run. Anything else is the disk's answer and belongs to the caller
        // (`docs/conventions.md` — a port rejects on what the runtime refuses).
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },

    write: async (account, ciphertext) => {
      const file = fileFor(account);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, ciphertext);
    },

    delete: async (account) => {
      try {
        await rm(fileFor(account));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },

    accounts: async () => {
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        // No folder yet is nothing stored yet, as `read` answers.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      const accounts: string[] = [];
      for (const name of names) {
        if (!name.endsWith(CIPHERTEXT_EXTENSION)) continue;
        try {
          accounts.push(decodeURIComponent(name.slice(0, -CIPHERTEXT_EXTENSION.length)));
        } catch {
          // A file a person named by hand that this store never wrote: not an account.
        }
      }
      return accounts;
    },
  };
}
