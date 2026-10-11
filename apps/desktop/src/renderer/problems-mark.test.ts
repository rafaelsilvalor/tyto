import { describe, expect, it } from 'vitest';

import type { Diagnostic } from './panel.js';
import {
  FILE_NOT_FOUND,
  SESSION_DRAFT_STALE,
  TEMPLATE_FOLDER_EMPTY,
  UNLIT,
  WINDOW_RAISED_CODES,
  type RowSubjects,
  afterRemoval,
  carriedAcrossTemplateRead,
  raised,
  seen,
  withoutRowsAbout,
} from './problems-mark.js';
import { SAVE_FAILED } from './save-failure.js';

/**
 * The "new problems" rule (TYTO-143, ADR 0076), as values. Whether the dot is drawn and
 * whether a real save failure reaches it is `status-bar.test.ts` and
 * `e2e/problems-mark.desktop.test.ts`.
 */

const row = (code: string): Diagnostic => ({ severity: 'error', code, message: code });

describe('the mark', () => {
  it('lights when a window row is raised while the panel is not on screen', () => {
    expect(raised(UNLIT, false).lit).toBe(true);
  });

  it('stays dark when the row is raised while the panel is on screen', () => {
    expect(raised(UNLIT, true).lit).toBe(false);
    expect(raised({ lit: true }, true).lit).toBe(false);
  });

  it('stays lit through a second raise and clears when the panel is seen', () => {
    const twice = raised(raised(UNLIT, false), false);
    expect(twice.lit).toBe(true);
    expect(seen(twice).lit).toBe(false);
  });

  it('lights again for the same failure raised after it was seen', () => {
    expect(raised(seen(raised(UNLIT, false)), false).lit).toBe(true);
  });

  it('names exactly the four codes the window raises', () => {
    expect([...WINDOW_RAISED_CODES].sort()).toEqual(
      [FILE_NOT_FOUND, SAVE_FAILED, SESSION_DRAFT_STALE, TEMPLATE_FOLDER_EMPTY].sort(),
    );
  });
});

describe('carriedAcrossTemplateRead', () => {
  it('keeps a save failure and a missing file, and drops what the template read remakes', () => {
    const before = [
      row(SAVE_FAILED),
      row('E_TEMPLATE_MANIFEST_INVALID'),
      row(FILE_NOT_FOUND),
      row(TEMPLATE_FOLDER_EMPTY),
    ];
    expect(carriedAcrossTemplateRead(before).map((item) => item.code)).toEqual([
      SAVE_FAILED,
      FILE_NOT_FOUND,
    ]);
  });

  it("keeps the applied theme's rows, which only a theme answer remakes (TYTO-208)", () => {
    const before = [row('E_THEME_INVALID'), row('E_TEMPLATE_MANIFEST_INVALID')];
    expect(carriedAcrossTemplateRead(before).map((item) => item.code)).toEqual(['E_THEME_INVALID']);
  });
});

describe('withoutRowsAbout (TYTO-260)', () => {
  const about = (subjects: RowSubjects, code: string, subject: string): Diagnostic => {
    const made = row(code);
    subjects.set(made, subject);
    return made;
  };

  it("takes away the save failure of the tab that saved, and keeps another tab's", () => {
    const subjects: RowSubjects = new WeakMap();
    const mine = about(subjects, SAVE_FAILED, 'doc-1');
    const theirs = about(subjects, SAVE_FAILED, 'doc-2');
    const compiler = row('E_TEMPLATE_MANIFEST_INVALID');

    const left = withoutRowsAbout([mine, compiler, theirs], subjects, SAVE_FAILED, 'doc-1');
    expect(left).toEqual([compiler, theirs]);
    expect(left[1]).toBe(theirs);
  });

  it('takes away a missing file once that path opens, and only under its own code', () => {
    const subjects: RowSubjects = new WeakMap();
    const missing = about(subjects, FILE_NOT_FOUND, 'C:/briefs/a.brief');
    const failed = about(subjects, SAVE_FAILED, 'C:/briefs/a.brief');

    expect(
      withoutRowsAbout([missing, failed], subjects, FILE_NOT_FOUND, 'C:/briefs/a.brief'),
    ).toEqual([failed]);
  });

  it('leaves a row nobody keyed alone, such as a missing file the session restored', () => {
    const subjects: RowSubjects = new WeakMap();
    const restored = row(FILE_NOT_FOUND);
    expect(withoutRowsAbout([restored], subjects, FILE_NOT_FOUND, 'C:/briefs/a.brief')).toEqual([
      restored,
    ]);
  });
});

describe('afterRemoval (TYTO-260)', () => {
  it('never lights the mark', () => {
    expect(afterRemoval(UNLIT, [row(SAVE_FAILED)]).lit).toBe(false);
    expect(afterRemoval(UNLIT, []).lit).toBe(false);
  });

  it('puts the mark out when no window row is left for it to point at', () => {
    expect(afterRemoval({ lit: true }, [row('E_TEMPLATE_MANIFEST_INVALID')]).lit).toBe(false);
  });

  it('keeps the mark lit while another window row is still there', () => {
    expect(afterRemoval({ lit: true }, [row(FILE_NOT_FOUND)]).lit).toBe(true);
  });
});
