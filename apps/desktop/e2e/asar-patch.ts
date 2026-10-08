/**
 * One byte of one file inside an `app.asar`, changed so that only a hash can tell (TYTO-241).
 *
 * **Why whitespace for whitespace.** The question is whether Electron refuses an archive whose
 * bytes no longer match the hash electron-builder wrote. A patch that also broke the
 * JavaScript would make the app fail with or without that check, and a refusal would then
 * prove nothing. A space swapped for a tab at the start of a line leaves the script as valid
 * as it was, so an app that checks nothing boots, and one that does refuses.
 *
 * The archive layout is read by hand rather than through `@electron/asar`, which is not a
 * dependency of this package: two Chromium pickles, the second holding the header as JSON,
 * then the files' bytes. `offset` in the header counts from the end of the second pickle.
 */

interface AsarEntry {
  readonly files?: Record<string, AsarEntry>;
  readonly offset?: string;
  readonly size?: number;
  readonly unpacked?: boolean;
}

export interface AsarPatch {
  /** The archive with one byte changed. The input buffer is left as it was. */
  readonly bytes: Buffer;
  /** Where in the archive the changed byte sits. */
  readonly archiveOffset: number;
}

const SPACE = 0x20;
const TAB = 0x09;
const NEWLINE = 0x0a;

/** Where one packed file's bytes sit in the archive. */
function locate(archive: Buffer, entryPath: string): { start: number; end: number } {
  // First pickle: a 4-byte payload holding the size of the second.
  const headerPickleSize = archive.readUInt32LE(4);
  // Second pickle: payload size, then the string's length, then the string.
  const headerLength = archive.readUInt32LE(12);
  const header = JSON.parse(archive.toString('utf8', 16, 16 + headerLength)) as AsarEntry;
  const contentStart = 8 + headerPickleSize;

  let entry: AsarEntry | undefined = header;
  for (const segment of entryPath.split('/')) entry = entry?.files?.[segment];
  // Asked first: an unpacked entry has a size and no offset, and would otherwise read as absent.
  if (entry?.unpacked === true) throw new Error(`${entryPath} is unpacked, not in the archive`);
  if (entry?.offset === undefined || entry.size === undefined) {
    throw new Error(`${entryPath} is not a packed file in this archive`);
  }

  const start = contentStart + Number(entry.offset);
  return { start, end: start + entry.size };
}

/** One packed file's bytes, read out of the archive as the packaged app would (TYTO-131). */
export function readPackedFile(archive: Buffer, entryPath: string): Buffer {
  const { start, end } = locate(archive, entryPath);
  return archive.subarray(start, end);
}

export function swapWhitespaceByte(archive: Buffer, entryPath: string): AsarPatch {
  const { start, end } = locate(archive, entryPath);
  for (let index = start + 1; index < end; index += 1) {
    if (archive[index] === SPACE && archive[index - 1] === NEWLINE) {
      const bytes = Buffer.from(archive);
      bytes[index] = TAB;
      return { bytes, archiveOffset: index };
    }
  }
  throw new Error(`${entryPath} has no line that starts with a space`);
}
