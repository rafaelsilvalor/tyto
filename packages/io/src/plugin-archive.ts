import { inflateRawSync } from 'node:zlib';

import { type Result, err, ok } from '@tyto/core';

/**
 * A `.zip` read into memory, for a plugin file's archive source (ADR 0197).
 *
 * Only what a repository's tag archive holds is read: stored or deflated files and folders.
 * Zip64, encryption and links are refused, and so is any name that would land outside the
 * folder it is extracted into. When every entry sits under one top folder, as a repository
 * host's archive puts them (`repo-v1.2.0/`), that folder is dropped, so the manifest is at the
 * copy's root as it is in a git checkout.
 */

/** A `.zip` larger than this is refused before it is read: no plugin is near it. */
export const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;

/** The total a `.zip` may expand to, so a small archive cannot fill the disk. */
export const ARCHIVE_MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

export interface ArchiveFile {
  /** The path inside the copy, `/`-separated, top folder dropped. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const ENCRYPTED_FLAG = 0x1;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_SYMLINK = 0o120000;

/** Why a name may not be written to disk, or nothing. */
function nameProblem(name: string): string | undefined {
  if (name.includes('\\')) return `'${name}' uses a backslash`;
  if (name.startsWith('/') || /^[a-z]:/iu.test(name)) return `'${name}' is an absolute path`;
  if (name.split('/').some((part) => part === '..')) return `'${name}' climbs out of the folder`;
  return undefined;
}

/** The files of a `.zip`, or why it is refused. Folders are implied by the files' paths. */
export function readZip(bytes: Uint8Array): Result<ArchiveFile[], string> {
  if (bytes.length > ARCHIVE_MAX_BYTES) {
    return err(`it is larger than ${ARCHIVE_MAX_BYTES / 1024 / 1024} MB`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is the last thing in the file, followed by a comment of at most 64 KB.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) return err('it is not a .zip');
  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) return err('a zip64 archive is not read');

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: { name: string; data: Uint8Array }[] = [];
  let expanded = 0;
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_DIRECTORY_ENTRY) {
      return err('its directory is damaged');
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const madeBy = view.getUint16(at + 4, true) >> 8;
    const attributes = view.getUint32(at + 38, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    const problem = nameProblem(name);
    if (problem !== undefined) return err(problem);
    if ((flags & ENCRYPTED_FLAG) !== 0) return err(`'${name}' is encrypted`);
    // 3 is Unix: the high half of the attributes is the file's mode.
    if (madeBy === 3 && ((attributes >>> 16) & UNIX_TYPE_MASK) === UNIX_SYMLINK) {
      return err(`'${name}' is a link, and a link may point outside the copy`);
    }
    if (name.endsWith('/')) continue;

    if (
      localOffset + 30 > bytes.length ||
      view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER
    ) {
      return err(`'${name}' is damaged`);
    }
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    if (start + compressedSize > bytes.length) return err(`'${name}' is cut short`);
    expanded += size;
    if (expanded > ARCHIVE_MAX_EXPANDED_BYTES) {
      return err(`it expands to more than ${ARCHIVE_MAX_EXPANDED_BYTES / 1024 / 1024} MB`);
    }
    const stored = bytes.subarray(start, start + compressedSize);
    let data: Uint8Array;
    if (method === STORED) data = stored;
    else if (method === DEFLATED) {
      try {
        data = inflateRawSync(stored, { maxOutputLength: Math.max(size, 1) });
      } catch {
        return err(`'${name}' does not inflate`);
      }
    } else return err(`'${name}' uses compression method ${method}, which is not read`);
    if (data.length !== size) return err(`'${name}' is not the size its directory says`);
    entries.push({ name, data });
  }

  const tops = new Set(entries.map((entry) => entry.name.split('/')[0]));
  const [top] = tops;
  const dropTop = tops.size === 1 && entries.every((entry) => entry.name.includes('/'));
  const files = entries.map((entry) => ({
    path: dropTop ? entry.name.slice((top ?? '').length + 1) : entry.name,
    bytes: entry.data,
  }));
  const seen = new Set<string>();
  for (const file of files) {
    // Windows reads two names that differ in case as one file.
    const key = file.path.toLowerCase();
    if (seen.has(key)) return err(`'${file.path}' is in it twice`);
    seen.add(key);
  }
  return ok(files);
}
