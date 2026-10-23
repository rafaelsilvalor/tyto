import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { EXPLORER_IMAGE_MAX_BYTES, type IpcResponse } from '../../shared/ipc.js';

/**
 * An image the explorer lists, read for the preview (TYTO-366, ADR 0124).
 *
 * **Main decides what the bytes are.** The window asks by explorer id and gets a `data:` URI
 * whose MIME type main chose from the first bytes of the file, checked against the extension;
 * a `.png` that is not a PNG is `unsupported`, never passed on under the name it claims. An SVG
 * must be text that holds `<svg`, and it travels only as `data:image/svg+xml` for an `<img>`, so
 * it is drawn as a picture and never as a document (no scripts, no loads).
 *
 * **The size is asked before a byte is read**: a file over the ceiling answers `too-large` from
 * its `stat` alone, and a watcher event answers `unchanged` from a `stat` too, so a 30 MB photo is
 * read once per change on disk and not once per event.
 */

export type ExplorerImage = IpcResponse<'explorer:image'>;

/** The most an image the preview shows may weigh: what a plugin's asset may (ADR 0117). */
export const IMAGE_MAX_BYTES = EXPLORER_IMAGE_MAX_BYTES;

/** The extensions the preview shows, each with the one MIME type its bytes must prove. */
const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
} as const;

export type ImageMime = (typeof MIME_BY_EXTENSION)[keyof typeof MIME_BY_EXTENSION];

/** The extensions {@link readExplorerImage} accepts, for `ExplorerService.filePath`. */
export const IMAGE_EXTENSIONS: readonly string[] = Object.keys(MIME_BY_EXTENSION);

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0): boolean =>
  prefix.every((byte, index) => bytes[at + index] === byte);

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

/** Whether `bytes` are UTF-8 text with an `<svg` element in them, and no NUL. */
function isSvgText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return !text.includes('\u0000') && /<svg[\s>/]/iu.test(text);
}

/** What the first bytes prove for each MIME type. */
const PROVES: Readonly<Record<ImageMime, (bytes: Uint8Array) => boolean>> = {
  'image/png': (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  'image/gif': (bytes) => startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a')),
  'image/webp': (bytes) => startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8),
  'image/svg+xml': isSvgText,
};

/**
 * The MIME type `bytes` are, when it is the one `name`'s extension promises; `undefined` for an
 * extension the preview does not show or bytes that are something else.
 */
export function imageMimeOf(name: string, bytes: Uint8Array): ImageMime | undefined {
  const extension = extname(name).toLowerCase();
  if (!(extension in MIME_BY_EXTENSION)) return undefined;
  const mime = MIME_BY_EXTENSION[extension as keyof typeof MIME_BY_EXTENSION];
  return PROVES[mime](bytes) ? mime : undefined;
}

/** A file's version as the window holds it: when it was written and how big it is. */
const versionOf = (info: { mtimeMs: number; size: number }): string =>
  `${String(info.mtimeMs)}:${String(info.size)}`;

/** The parts of `node:fs/promises` this reads with, injected so a test can count them. */
export interface ImageDisk {
  readonly stat: (path: string) => Promise<{ isFile(): boolean; mtimeMs: number; size: number }>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
}

const REAL_DISK: ImageDisk = { stat, readFile };

/**
 * The image at `path`, which `ExplorerService.filePath` already found inside the open folder.
 * `have` is the version the window shows; the same version answers `unchanged` without a read.
 */
export async function readExplorerImage(
  path: string,
  have: string | undefined,
  max: number = IMAGE_MAX_BYTES,
  disk: ImageDisk = REAL_DISK,
): Promise<ExplorerImage> {
  const name = basename(path);
  let info: Awaited<ReturnType<ImageDisk['stat']>>;
  try {
    info = await disk.stat(path);
  } catch {
    return { ok: false, reason: 'gone', name };
  }
  if (!info.isFile()) return { ok: false, reason: 'gone', name };
  const version = versionOf(info);
  if (have === version) return { unchanged: true };
  if (info.size > max) return { ok: false, reason: 'too-large', name, bytes: info.size, version };
  let bytes: Uint8Array;
  try {
    bytes = await disk.readFile(path);
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    return { ok: false, reason: code === 'ENOENT' ? 'gone' : 'failed', name };
  }
  // The file can have grown between the two calls; what was read is what is judged.
  if (bytes.byteLength > max) {
    return { ok: false, reason: 'too-large', name, bytes: bytes.byteLength };
  }
  const mime = imageMimeOf(name, bytes);
  // Both carry the version, so a watcher event over a file that has not changed is a `stat`.
  if (mime === undefined) {
    return { ok: false, reason: 'unsupported', name, bytes: bytes.byteLength, version };
  }
  return {
    ok: true,
    name,
    mime,
    bytes: bytes.byteLength,
    version,
    dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
  };
}
