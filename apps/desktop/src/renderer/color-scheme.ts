import { type ThemeName } from '@tyto/editor';

/**
 * Which of the editor's two themes the window is in, and the moment that changes.
 *
 * The window's colours follow the system on their own: `tokens.css` redefines its custom
 * properties under `prefers-color-scheme: dark`, and Electron answers that query from the
 * system, live. The editor reads the same properties, so its colours follow too. What CSS
 * cannot reach is CodeMirror's `dark` flag, which picks the base theme for the parts the
 * palette does not style — so it is set from the same media query, when the window opens and
 * whenever the system changes (TYTO-96, comment 1291578). Before this the editor was created
 * `light` and stayed white in a dark window.
 *
 * The in-app override is the `theme` setting's `mode` (TYTO-208, ADR 0077), and it reaches
 * this query rather than replacing it: main sets `nativeTheme.themeSource`, which is what
 * Electron answers `prefers-color-scheme` from, so the window's colours, this flag and the
 * native dialogs follow the one value.
 */
const DARK = '(prefers-color-scheme: dark)';

/** The part of `window` this module reads, so a test can hand it a stand-in. */
export interface SchemeSource {
  readonly matchMedia?: (query: string) => MediaQueryList;
}

/**
 * Calls `apply` with the scheme now and again each time the system changes it, and answers
 * the function that stops listening.
 *
 * A host with no `matchMedia` is light and never changes. That is jsdom, where the renderer's
 * unit suites run, and no window the app opens.
 */
export const followScheme = (
  apply: (scheme: ThemeName) => void,
  source: SchemeSource = window,
): (() => void) => {
  if (typeof source.matchMedia !== 'function') {
    apply('light');
    return () => undefined;
  }
  const query = source.matchMedia(DARK);
  const changed = (event: MediaQueryListEvent): void => {
    apply(event.matches ? 'dark' : 'light');
  };
  apply(query.matches ? 'dark' : 'light');
  query.addEventListener('change', changed);
  return () => {
    query.removeEventListener('change', changed);
  };
};
