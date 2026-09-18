import { type Locale, translate } from '../../shared/i18n/index.js';
import type { Diagnostic } from './panel.js';

/** The code every save failure is filed under, so the next one replaces the last. */
export const SAVE_FAILED = 'E_SAVE_FAILED';

/**
 * What the system said went wrong, shortened to something a panel row can hold.
 *
 * A rejected `file:save` arrives as whatever crossed the bridge — an `Error` from `writeFile`
 * on the far side, or an `IpcContractError` if the message itself was refused. Neither is
 * written for a person, and both are better than nothing: *EACCES: permission denied* names
 * the actual problem, and a row that said only "it failed" would send somebody to the log for
 * a sentence that could have been on screen.
 *
 * Trimmed to one line and 200 characters, the same ceiling `log:write` puts on a message. A
 * stack trace in the problems panel would push every compiler diagnostic off the screen.
 */
function reasonOf(cause: unknown): string | undefined {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const line = raw.split('\n')[0]?.trim() ?? '';
  if (line === '') return undefined;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/**
 * The row the problems panel shows when a save did not write (TYTO-124).
 *
 * **A diagnostic and not a dialog, and that is the card's one decision.** The panel is where
 * *why is this not working* already goes — `E_FILE_NOT_FOUND` is minted the same way, in the
 * same file, for a file that vanished — and this window is deliberate about having exactly one
 * box that interrupts: the quit question, whose own comment says a second one would train a
 * person to dismiss the one that matters.
 *
 * What is lost by choosing the panel is that a collapsed panel shows nothing. What is kept is
 * that the unsaved marker stays lit, correctly, because `savedText` never moved — so the
 * window is silent about the failure but has never claimed the file was written.
 *
 * No `range`: nothing in the brief is wrong. `panel.ts` already draws a range-less row as
 * text rather than as a button, by a decision of its own.
 *
 * Pure, and in its own module rather than inline in `main.ts`, because `main.ts` has no unit
 * suite — the composition of the window is what the end-to-end suite is for, and a sentence a
 * person reads deserves a test that does not need a browser.
 */
export function saveFailureDiagnostic(
  locale: Locale,
  name: string | undefined,
  cause: unknown,
): Diagnostic {
  const untitled = translate(locale, 'document.untitled');
  const reason = reasonOf(cause);
  const subject = `${translate(locale, 'file.saveFailed')}: ${name ?? untitled}`;

  return {
    severity: 'error',
    code: SAVE_FAILED,
    message: reason === undefined ? subject : `${subject} — ${reason}`,
  };
}
