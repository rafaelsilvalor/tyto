/**
 * Codes the desktop window mints itself, rather than a compiler stage (TYTO-141).
 *
 * They are not in `@tyto/core`'s catalogue and must not be: none of them is about a brief, and
 * `core` cannot know the window exists. But they reach the problems panel drawn exactly like a
 * compiler diagnostic, so a person reading one off a screenshot greps
 * `docs/diagnostic-codes.md` for it — and until this list existed, found nothing.
 *
 * **Why the window and not main.** The renderer owns the locale; main does not. Main can tell
 * that a file moved or a folder held no templates, but only the window knows which language to
 * say it in, so the window builds the row. That is the whole reason this category exists, and
 * why `shared/ipc.ts` declares a diagnostic's `code` as `z.string()` instead of `core`'s union.
 *
 * Hand-written, so it can drift from the call sites; `tools/repo-checks` closes that gap by
 * failing when a code literal under `apps/desktop` is not mentioned in the generated doc.
 */
export interface DesktopCode {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  /** The module that builds the row, relative to `apps/desktop/src`. */
  readonly mintedIn: string;
  /** When a person sees it. */
  readonly summary: string;
  /** The i18n key the message starts with, and its English text. */
  readonly messageKey: string;
  readonly english: string;
  /** What follows the translated sentence. */
  readonly suffix: string;
}

export const desktopCodes: readonly DesktopCode[] = [
  {
    code: 'E_FILE_NOT_FOUND',
    severity: 'error',
    mintedIn: 'renderer/main.ts',
    summary: 'A file reopened from the recent list is no longer where it was.',
    messageKey: 'file.missing',
    english: 'This file is no longer where it was',
    suffix: 'the file name',
  },
  {
    code: 'E_TEMPLATE_FOLDER_EMPTY',
    severity: 'warning',
    mintedIn: 'renderer/main.ts',
    summary:
      'The chosen templates folder holds no templates (TYTO-122). A warning despite its `E_` prefix.',
    messageKey: 'templates.folder.empty',
    english: 'This folder has no templates',
    suffix: 'the folder path',
  },
  {
    code: 'E_SAVE_FAILED',
    severity: 'error',
    mintedIn: 'renderer/save-failure.ts',
    summary: 'A save did not write the file; the unsaved marker stays lit (TYTO-124).',
    messageKey: 'file.saveFailed',
    english: 'This file was not saved',
    suffix: 'the file name, then the reason the system gave, when it gave one',
  },
];
