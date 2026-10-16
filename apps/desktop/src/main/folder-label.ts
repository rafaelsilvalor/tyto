import { posix, win32 } from 'node:path';

/**
 * The folder a file is in, as a tab's tooltip shows it (TYTO-288, ADR 0086).
 *
 * **A sentence for a person, not a path for a program.** The home directory is shortened to
 * `~`, the way Zed and VS Code write it, so `C:\Users\rafael\Documents\campanhas` reads as
 * `~\Documents\campanhas`. That is also why it cannot be handed back: no channel that opens or
 * writes a file accepts it, and `~` is not something any of them would expand.
 *
 * Pure and given the platform, so both separators are tested on every machine. On Windows the
 * comparison ignores case, because `C:\users\RAFAEL` is the same folder as `C:\Users\rafael` and
 * a dialog may answer with either spelling; elsewhere it does not.
 */
export function folderLabelOf(
  file: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const windows = platform === 'win32';
  const folder = (windows ? win32 : posix).dirname(file);
  // A home of `/` or `C:\` would shorten every path on the disk to `~`, which says less than the
  // path itself, so a root is not a home here.
  const base = home.replace(windows ? /[\\/]+$/u : /\/+$/u, '');
  if (base === '' || (windows && /^[a-z]:$/iu.test(base))) return folder;

  const fold = (text: string): string => (windows ? text.toLowerCase() : text);
  if (fold(folder) === fold(base)) return '~';
  const separator = folder.charAt(base.length);
  const separates = separator === '/' || (windows && separator === '\\');
  if (separates && fold(folder.slice(0, base.length)) === fold(base)) {
    return `~${folder.slice(base.length)}`;
  }
  return folder;
}
