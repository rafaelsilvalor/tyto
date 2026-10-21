/**
 * Path arithmetic for the project file, without `node:path` (ADR 0010).
 *
 * The resolver turns what `project.json` wrote into absolute folders and decides, before any
 * disk is read, whether a restricted source's folder key stays inside the source (ADR 0111).
 * That is string work on a path, and `core` may not import Node to do it, so it is written
 * here once for both shapes a path arrives in: POSIX (`/home/x`) and Windows (`D:\work`,
 * `\\server\share`). Which shape is the **root's**, because the root is a real folder the
 * composition root handed over, while a value is whatever a person typed.
 *
 * Lexical only. A link inside the folder that leads out is invisible here; the I/O side runs
 * the same check again after `realpath` (ADR 0111, ADR 0112). Nothing is decoded either, so
 * `%2e%2e` is a folder name.
 */

/** Whether `path` is absolute in either shape. */
export function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/])/u.test(path);
}

function isWindowsShaped(path: string): boolean {
  return /^[A-Za-z]:/u.test(path) || path.startsWith('\\');
}

/** The prefix no `..` may climb above: `/`, `D:\` or `\\server\share\`. */
function prefixOf(path: string): { readonly prefix: string; readonly rest: string } {
  const unc = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/u.exec(path);
  if (unc !== null) return { prefix: unc[0], rest: path.slice(unc[0].length) };
  const drive = /^[A-Za-z]:/u.exec(path);
  if (drive !== null) return { prefix: drive[0], rest: path.slice(drive[0].length) };
  return { prefix: '', rest: path };
}

/** `path` with `.` dropped, `..` applied and one separator, in the shape `windows` names. */
function normalise(path: string, windows: boolean): string {
  const separator = windows ? '\\' : '/';
  const { prefix, rest } = prefixOf(path);
  const parts: string[] = [];
  for (const part of rest.split(/[\\/]/u)) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const head = windows ? prefix.replace(/\//gu, '\\') : prefix;
  return `${head}${separator}${parts.join(separator)}`;
}

/**
 * `value` as an absolute path: itself when it is absolute, else joined onto `root`.
 *
 * `root` must be absolute; the composition root guarantees it, and a relative one is a bug
 * there, not a mistake in a file somebody wrote.
 */
export function resolvePath(root: string, value: string): string {
  const windows = isWindowsShaped(root);
  return normalise(isAbsolutePath(value) ? value : `${root}/${value}`, windows);
}

/**
 * Whether `path` is `root` or inside it, both already absolute.
 *
 * Compared segment by segment rather than with `startsWith`, so `/work-evil` is not inside
 * `/work`; and without case on a Windows-shaped root, as that file system compares.
 */
export function isInsidePath(root: string, path: string): boolean {
  const windows = isWindowsShaped(root);
  const fold = (text: string): string => (windows ? text.toLowerCase() : text);
  const rootParts = fold(normalise(root, windows)).split(/[\\/]/u).filter(Boolean);
  const pathParts = fold(normalise(path, windows)).split(/[\\/]/u).filter(Boolean);
  if (pathParts.length < rootParts.length) return false;
  return rootParts.every((part, index) => pathParts[index] === part);
}
