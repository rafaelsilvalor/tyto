/**
 * Where a file is, as a tab's tooltip shows it (TYTO-288, ADR 0086).
 *
 * **A sentence for a person, not a path for a program.** The home directory is shortened to
 * `~`, the way VS Code writes it, so `C:\Users\rafael\Documents\campanhas\promo.brief` reads as
 * `~\Documents\campanhas\promo.brief`. That is also why it cannot be handed back: no channel that
 * opens or writes a file accepts it, and `~` is not something any of them would expand.
 *
 * Pure and given the platform, so both separators are tested on every machine. On Windows the
 * comparison ignores case, because `C:\users\RAFAEL` is the same folder as `C:\Users\rafael` and
 * a dialog may answer with either spelling; elsewhere it does not.
 */
export function pathLabelOf(
  file: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const windows = platform === 'win32';
  // As main holds it: a dialog answers in the platform's own separators, and so does the label.
  const path = file;
  // A home of `/` or `C:\` would shorten every path on the disk to `~`, which says less than the
  // path itself, so a root is not a home here.
  const base = home.replace(windows ? /[\\/]+$/u : /\/+$/u, '');
  if (base === '' || (windows && /^[a-z]:$/iu.test(base))) return path;

  const fold = (text: string): string => (windows ? text.toLowerCase() : text);
  const separator = path.charAt(base.length);
  const separates = separator === '/' || (windows && separator === '\\');
  if (separates && fold(path.slice(0, base.length)) === fold(base)) {
    return `~${path.slice(base.length)}`;
  }
  return path;
}
