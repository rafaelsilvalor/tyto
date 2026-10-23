/**
 * Where a file is, as a tab's tooltip shows it (TYTO-288, ADR 0086; TYTO-274, ADR 0125).
 *
 * **A sentence for a person, not a path for a program.** Inside the open workspace folder the
 * label is relative to it and starts with the folder's own name, so
 * `D:\trabalho\promo\briefs\capa.brief` with `D:\trabalho\promo` open reads as
 * `promo\briefs\capa.brief` (ADR 0125). Outside it, the home directory is shortened to `~`, the
 * way VS Code writes it, so `C:\Users\rafael\Documents\campanhas\promo.brief` reads as
 * `~\Documents\campanhas\promo.brief`. That is also why it cannot be handed back: no channel that
 * opens or writes a file accepts it, and neither `~` nor a bare folder name is something any of
 * them would expand.
 *
 * Pure and given the platform, so both separators are tested on every machine. On Windows the
 * comparison ignores case, because `C:\users\RAFAEL` is the same folder as `C:\Users\rafael` and
 * a dialog may answer with either spelling; elsewhere it does not.
 */
export function pathLabelOf(
  file: string,
  home: string,
  root?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const windows = platform === 'win32';
  // As main holds it: a dialog answers in the platform's own separators, and so does the label.
  const path = file;

  if (root !== undefined) {
    const folder = baseOf(root, windows);
    const name = folder === undefined ? '' : nameOf(folder, windows);
    // A drive or `/` as the open folder has no name to start the label with; home's rule applies.
    if (folder !== undefined && name !== '') {
      const rest = restUnder(folder, path, windows);
      if (rest !== undefined) return `${name}${rest}`;
    }
  }

  const base = baseOf(home, windows);
  if (base === undefined) return path;
  const rest = restUnder(base, path, windows);
  return rest === undefined ? path : `~${rest}`;
}

/**
 * A folder without its trailing separators, or nothing for a root: a home of `/` or `C:\` would
 * shorten every path on the disk to `~`, which says less than the path itself.
 */
function baseOf(folder: string, windows: boolean): string | undefined {
  const base = folder.replace(windows ? /[\\/]+$/u : /\/+$/u, '');
  if (base === '' || (windows && /^[a-z]:$/iu.test(base))) return undefined;
  return base;
}

/** The last part of a folder's path: `promo` for `D:\trabalho\promo`. */
function nameOf(folder: string, windows: boolean): string {
  const parts = folder.split(windows ? /[\\/]/u : /\//u);
  return parts[parts.length - 1] ?? '';
}

/**
 * What follows `base` in `path`, its separator first, or `''` for `base` itself; nothing when
 * `path` is not at or under it. A sibling whose name starts with the base's is not under it.
 */
function restUnder(base: string, path: string, windows: boolean): string | undefined {
  // On Windows `/` and `\` are one separator and case is not part of a name.
  const fold = (text: string): string =>
    windows ? text.toLowerCase().replaceAll('/', '\\') : text;
  if (fold(path.slice(0, base.length)) !== fold(base)) return undefined;
  if (path.length === base.length) return '';
  const separator = path.charAt(base.length);
  const separates = separator === '/' || (windows && separator === '\\');
  return separates ? path.slice(base.length) : undefined;
}
