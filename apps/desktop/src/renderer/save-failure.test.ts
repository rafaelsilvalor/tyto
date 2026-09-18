import { describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import { SAVE_FAILED, saveFailureDiagnostic } from './save-failure.js';

/**
 * The sentence a person reads when a save did not write (TYTO-124).
 *
 * In its own suite because `main.ts` has none: the window's composition is what the
 * end-to-end suite is for, and this is the one piece of that path which is a pure function of
 * a locale, a name and whatever the bridge rejected with. `e2e/documents.desktop.test.ts` is
 * where the row is shown to actually reach the panel.
 */
describe('saveFailureDiagnostic', () => {
  it('names the file, in the language the window is in', () => {
    const diagnostic = saveFailureDiagnostic('pt-BR', 'campanha.brief', new Error('EACCES'));

    expect(diagnostic.message).toContain('campanha.brief');
    expect(diagnostic.message).toContain(translate('pt-BR', 'file.saveFailed'));
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.code).toBe(SAVE_FAILED);
  });

  it('follows the picker and not the system, which is the whole of taking a locale', () => {
    const message = saveFailureDiagnostic('en', 'a.brief', new Error('EACCES')).message;

    expect(message).toContain(translate('en', 'file.saveFailed'));
    expect(message).not.toContain(translate('pt-BR', 'file.saveFailed'));
  });

  it('says untitled when the tab has never been saved', () => {
    // A save-as that failed on a new tab: there is no name to print, and printing nothing
    // would leave a sentence with a colon and a blank after it.
    const message = saveFailureDiagnostic('pt-BR', undefined, new Error('ENOSPC')).message;

    expect(message).toContain(translate('pt-BR', 'document.untitled'));
  });

  it('carries the reason the system gave, which is the part that is actionable', () => {
    const message = saveFailureDiagnostic(
      'pt-BR',
      'a.brief',
      new Error('EACCES: permission denied, open /etc/a.brief'),
    ).message;

    // *permission denied* is what tells somebody to try another folder. A row that said only
    // "it failed" would send them to the log for a sentence that could have been on screen.
    expect(message).toContain('permission denied');
  });

  it('keeps a stack trace out of the panel', () => {
    const noisy = new Error('EACCES: denied');
    noisy.stack = 'Error: EACCES: denied\n    at writeFile (node:fs:1)\n    at save (app:2)';

    const message = saveFailureDiagnostic('pt-BR', 'a.brief', noisy).message;

    // One line, and short. The panel is a list of diagnostics about the brief; a trace here
    // would push every compiler message off the screen.
    expect(message).not.toContain('\n');
    expect(message.length).toBeLessThan(240);
  });

  it('still says something when the rejection carried no message at all', () => {
    // A rejection with no `Error` in it is not hypothetical: `parseIpc` refuses a malformed
    // message in the preload, and what arrives is whatever it threw.
    const message = saveFailureDiagnostic('pt-BR', 'a.brief', undefined).message;

    expect(message).toContain(translate('pt-BR', 'file.saveFailed'));
    expect(message).toContain('a.brief');
    expect(message.trim().endsWith('—')).toBe(false);
  });

  it('files every failure under one code, so the next one replaces the last', () => {
    // `main.ts` rebuilds `panel.installation` filtering on this code, the way it does for
    // `E_FILE_NOT_FOUND`. Two failed saves are the same problem said twice, not two problems.
    const first = saveFailureDiagnostic('pt-BR', 'a.brief', new Error('one'));
    const second = saveFailureDiagnostic('pt-BR', 'b.brief', new Error('two'));

    expect(first.code).toBe(second.code);
  });

  it('has no range, because nothing in the brief is wrong', () => {
    // `problems-panel.ts` draws a range-less row as text rather than as a button, by a
    // decision of its own: there is nowhere in the document for it to jump to.
    expect(saveFailureDiagnostic('pt-BR', 'a.brief', new Error('x'))).not.toHaveProperty('range');
  });
});
