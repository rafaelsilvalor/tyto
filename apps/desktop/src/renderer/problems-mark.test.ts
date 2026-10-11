import { describe, expect, it } from 'vitest';

import type { Diagnostic } from './panel.js';
import {
  FILE_NOT_FOUND,
  TEMPLATE_FOLDER_EMPTY,
  UNLIT,
  WINDOW_RAISED_CODES,
  carriedAcrossTemplateRead,
  raised,
  seen,
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

  it('names exactly the three codes the window raises', () => {
    expect([...WINDOW_RAISED_CODES].sort()).toEqual(
      [FILE_NOT_FOUND, SAVE_FAILED, TEMPLATE_FOLDER_EMPTY].sort(),
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
