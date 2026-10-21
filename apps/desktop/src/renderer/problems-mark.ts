import type { Diagnostic } from './panel.js';
import { SAVE_FAILED } from './save-failure.js';
import { THEME_CODES } from './theme.js';
import { WORKSPACE_CODES } from './workspace-folder.js';
import { FONT_FAMILY_MISSING } from './typography.js';

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
/** TYTO-113: a kept draft not put back over a file that changed while the app was closed. */
export const SESSION_DRAFT_STALE = 'W_SESSION_DRAFT_STALE';

/** The codes this window raises itself, and the only ones that light the mark. */
export const WINDOW_RAISED_CODES: ReadonlySet<string> = new Set([
  FILE_NOT_FOUND,
  SESSION_DRAFT_STALE,
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
      item.code === SAVE_FAILED ||
      item.code === FILE_NOT_FOUND ||
      item.code === SESSION_DRAFT_STALE ||
      // A face the machine lacks (TYTO-272) is the theme answer's, like a theme's own rows.
      item.code === FONT_FAMILY_MISSING ||
      THEME_CODES.has(item.code) ||
      // The open folder's rows (TYTO-278) are the workspace answer's, like a theme's.
      WORKSPACE_CODES.has(item.code),
  );

/**
 * What a window-raised row is about (TYTO-260): the document whose save failed, or the path
 * that was not found. Kept beside the rows rather than on them, because a `Diagnostic` is the
 * panel's shape and a subject is nothing a person reads. Weak, so a row the list drops takes
 * its subject with it; a template read carries rows by identity, so the subject survives it.
 */
export type RowSubjects = WeakMap<Diagnostic, string>;

/**
 * The rows left once `subject` stopped being a problem under `code` (TYTO-260): a save of that
 * document went through, or that path opened. Without it an `E_SAVE_FAILED` row outlived the
 * save that fixed it — and since TYTO-143 it outlives a template read too — so the panel and
 * the count said the file was not written when it was. Only rows about that subject go: a
 * failure about another tab is still true.
 */
export const withoutRowsAbout = (
  installation: readonly Diagnostic[],
  subjects: RowSubjects,
  code: string,
  subject: string,
): readonly Diagnostic[] =>
  installation.filter((item) => !(item.code === code && subjects.get(item) === subject));

/**
 * The mark after rows were taken away (TYTO-260). A removal never lights it — nothing new
 * arrived — and when no window-raised row is left it goes dark, so it never points at nothing.
 */
export const afterRemoval = (
  mark: ProblemsMark,
  installation: readonly Diagnostic[],
): ProblemsMark => (installation.some((item) => WINDOW_RAISED_CODES.has(item.code)) ? mark : UNLIT);
