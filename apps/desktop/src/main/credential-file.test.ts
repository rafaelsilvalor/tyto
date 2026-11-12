import { CREDENTIAL_VALUE_LIMIT_BYTES } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import { type CredentialFileSource, importCredentialFile } from './credential-file.js';

/**
 * Importing a credential from a file (TYTO-649), with the picker and the disk injected. The
 * file is a fake service-account key with the real one's shape: several lines, and a
 * `private_key` whose line breaks are `\n` escapes inside the JSON string.
 */

const FAKE_KEY = `${JSON.stringify(
  {
    type: 'service_account',
    project_id: 'fake-project-649',
    private_key: '-----BEGIN PRIVATE KEY-----\nZmFrZS02NDk=\n-----END PRIVATE KEY-----\n',
    client_email: 'fake-649@fake-project-649.example',
  },
  null,
  2,
).replaceAll('\n', '\r\n')}\r\n`;

const PATH = 'C:/Users/ana/Downloads/fake-project-649-0123456789ab.json';

/**
 * A picker answering `path` (`null`: dismissed), over files whose bytes are `files`, recording
 * what was read.
 */
function source(
  files: Readonly<Record<string, Uint8Array>>,
  path: string | null = PATH,
  size?: number,
): CredentialFileSource & { readonly reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    choose: () => Promise.resolve(path ?? undefined),
    size: (chosen) => Promise.resolve(size ?? files[chosen]?.byteLength ?? 0),
    read: (chosen) => {
      reads.push(chosen);
      return Promise.resolve(files[chosen] ?? new Uint8Array());
    },
  };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function imported(from: CredentialFileSource) {
  const stored: string[] = [];
  const answer = await importCredentialFile(from, (text) => {
    stored.push(text);
    return Promise.resolve();
  });
  return { answer, stored };
}

describe('importing a credential from a file (TYTO-649)', () => {
  it("stores the file's exact text, line breaks and escapes included, and answers only that", async () => {
    const { answer, stored } = await imported(source({ [PATH]: bytes(FAKE_KEY) }));

    expect(answer).toEqual({ outcome: 'stored' });
    expect(stored).toEqual([FAKE_KEY]);
    expect(stored[0]).toContain('\r\n');
    expect((JSON.parse(stored[0]!) as { private_key: string }).private_key).toContain('\n');
    // The answer is all the window gets: neither the path nor a piece of the text.
    expect(JSON.stringify(answer)).not.toContain('fake-project-649');
    expect(JSON.stringify(answer)).not.toContain('Downloads');
  });

  it('stores nothing and reads nothing when the picker is dismissed', async () => {
    const from = source({ [PATH]: bytes(FAKE_KEY) }, null);
    const { answer, stored } = await imported(from);

    expect(answer).toEqual({ outcome: 'canceled' });
    expect(stored).toEqual([]);
    expect(from.reads).toEqual([]);
  });

  it('refuses a file over 16 KiB from its size, before reading a byte', async () => {
    const at = source({ [PATH]: bytes('a'.repeat(CREDENTIAL_VALUE_LIMIT_BYTES)) });
    expect((await imported(at)).answer).toEqual({ outcome: 'stored' });

    const over = source({ [PATH]: bytes('a'.repeat(CREDENTIAL_VALUE_LIMIT_BYTES + 1)) });
    const { answer, stored } = await imported(over);
    expect(answer).toEqual({ outcome: 'too-large' });
    expect(stored).toEqual([]);
    expect(over.reads).toEqual([]);
  });

  it('refuses a file that grew past 16 KiB between its size and its read', async () => {
    const grew = source({ [PATH]: bytes('a'.repeat(CREDENTIAL_VALUE_LIMIT_BYTES + 1)) }, PATH, 10);
    const { answer, stored } = await imported(grew);

    expect(answer).toEqual({ outcome: 'too-large' });
    expect(stored).toEqual([]);
  });

  it('refuses a file that is empty, blank or not UTF-8 text', async () => {
    for (const content of [
      new Uint8Array(),
      bytes(' \r\n\t'),
      Uint8Array.of(0xff, 0xfe, 0x00, 0x7b),
    ]) {
      const { answer, stored } = await imported(source({ [PATH]: content }));
      expect(answer).toEqual({ outcome: 'not-text' });
      expect(stored).toEqual([]);
    }
  });

  it('drops a UTF-8 byte-order mark, which JSON.parse would refuse', async () => {
    const withMark = Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes(FAKE_KEY));
    const { stored } = await imported(source({ [PATH]: withMark }));

    expect(stored).toEqual([FAKE_KEY]);
    expect(() => JSON.parse(stored[0]!) as unknown).not.toThrow();
  });
});
