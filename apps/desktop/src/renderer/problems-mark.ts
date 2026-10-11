import type { Diagnostic } from './panel.js';
import { SAVE_FAILED } from './save-failure.js';
import { THEME_CODES } from './theme.js';

/**
 * The "new problems" mark on the status bar's problems button (TYTO-143, ADR 0076).
 *
 * The count beside it says how many problems there are; this says that one arrived since the
 * problems panel was last on screen. A mark lit whenever the panel has a row would be lit
 * almost always, which is the same as never being lit.
 *
 * **Only the window's own codes light it.** Each is the answer to something a person just did
 * — opened a recent file, saved, chose a template folder. A compiler diagnostic arrives on
 * every keystroke, and the line under the stage already says how many there are.
 *
 * Pure, so the rule is a value a test can drive; `main.ts` holds the one instance and decides
 * when a row was raised and when the panel is on screen.
 */

export const FILE_NOT_FOUND = 'E_FILE_NOT_FOUND';
export const TEMPLATE_FOLDER_EMPTY = 'E_TEMPLATE_FOLDER_EMPTY';

/** The three codes this window raises itself, and the only ones that light the mark. */
export const WINDOW_RAISED_CODES: ReadonlySet<string> = new Set([
  FILE_NOT_FOUND,
  SAVE_FAILED,
  TEMPLATE_FOLDER_EMPTY,
]);

export interface ProblemsMark {
  readonly lit: boolean;
}

export const UNLIT: ProblemsMark = { lit: false };

/**
 * A window-raised row was just created. It lights the mark unless the panel is on screen,
 * where the row itself is the news. Called when the row is made, not by comparing lists, so a
 * second identical save failure lights it again: it is a second answer to a second key press.
 */
export const raised = (_mark: ProblemsMark, shown: boolean): ProblemsMark =>
  shown ? UNLIT : { lit: true };

/** The panel came on screen, so whatever was new has been seen. */
export const seen = (_mark: ProblemsMark): ProblemsMark => UNLIT;

/**
 * The rows a template read must carry over (TYTO-143).
 *
 * `refreshTemplates` rebuilds the installation list from main's answer, so without this a
 * template-folder change dropped a live save failure or missing file — and the mark would
 * point at nothing. The applied theme's rows are carried too (TYTO-208): only a theme answer
 * remakes them. `E_TEMPLATE_FOLDER_EMPTY` is not carried: it is the template read's own
 * row and is made again by that read whenever it still holds.
 */
export const carriedAcrossTemplateRead = (
  installation: readonly Diagnostic[],
): readonly Diagnostic[] =>
  installation.filter(
    (item) =>
      item.code === SAVE_FAILED || item.code === FILE_NOT_FOUND || THEME_CODES.has(item.code),
  );
