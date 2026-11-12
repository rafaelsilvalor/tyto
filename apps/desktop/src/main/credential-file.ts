import { CREDENTIAL_VALUE_LIMIT_BYTES } from '@tyto/plugin-api';

import type { CredentialFileOutcome } from '../../shared/ipc.js';

/**
 * A credential imported from a file (TYTO-649): a service account's JSON key, a PEM, anything
 * whose line breaks are part of the secret.
 *
 * **Main does all of it.** It opens the picker, reads the file and stores the text; the window
 * names the credential and hears back one of four words. The path and the text never cross the
 * bridge, so a renderer that misbehaves can neither learn where a key file lives nor read one.
 *
 * **The text is stored as it is in the file**, line breaks included, decoded as UTF-8. The one
 * thing dropped is a UTF-8 byte-order mark: it is not part of the text, and `JSON.parse` refuses
 * a key that begins with one.
 *
 * **The ceiling is a plugin credential's** (ADR 0134): over 16 KiB is `too-large`, read from the
 * file's size before a byte is read, and checked again on the bytes read in case it grew.
 */

/** The picker and the disk, injected so the logic runs without Electron. */
export interface CredentialFileSource {
  /** The file a person picked, or nothing when the picker was dismissed. */
  choose(): Promise<string | undefined>;
  /** The file's size in bytes. */
  size(path: string): Promise<number>;
  read(path: string): Promise<Uint8Array>;
}

/** Picks, reads and hands the text to `store`; answers what happened, never the path or text. */
export async function importCredentialFile(
  source: CredentialFileSource,
  store: (text: string) => Promise<unknown>,
): Promise<{ readonly outcome: CredentialFileOutcome }> {
  const path = await source.choose();
  if (path === undefined) return { outcome: 'canceled' };
  if ((await source.size(path)) > CREDENTIAL_VALUE_LIMIT_BYTES) return { outcome: 'too-large' };
  const bytes = await source.read(path);
  if (bytes.byteLength > CREDENTIAL_VALUE_LIMIT_BYTES) return { outcome: 'too-large' };
  const text = credentialText(bytes);
  if (text === undefined) return { outcome: 'not-text' };
  await store(text);
  return { outcome: 'stored' };
}

/** The file's UTF-8 text without a byte-order mark, or nothing when it is blank or not UTF-8. */
function credentialText(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    // `fatal`: a binary file is refused rather than stored with replacement characters.
    // `ignoreBOM: false` (the default) drops a leading byte-order mark.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  return text.trim() === '' ? undefined : text;
}
