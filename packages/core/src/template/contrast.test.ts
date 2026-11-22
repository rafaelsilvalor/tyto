import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast.js';

/** WCAG 2 contrast (TYTO-837), against pairs whose ratio is known. */
describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#1363d0', '#1363d0')).toBeCloseTo(1, 5);
  });

  it('is the same in either order', () => {
    expect(contrastRatio('#1363d0', '#eceaea')).toBeCloseTo(
      contrastRatio('#eceaea', '#1363d0')!,
      10,
    );
  });

  it('measures #767676 on white at 4.54, the darkest grey that passes 4.5', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#ffffff')!).toBeLessThan(4.5);
  });

  it('reads the short forms and ignores alpha', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff80', '#00000080')).toBeCloseTo(21, 5);
  });

  it('is undefined for anything that is not a hex colour', () => {
    expect(contrastRatio('red', '#000000')).toBeUndefined();
    expect(relativeLuminance('#12')).toBeUndefined();
  });

  it('weighs green over red over blue, as the eye does', () => {
    expect(relativeLuminance('#00ff00')!).toBeGreaterThan(relativeLuminance('#ff0000')!);
    expect(relativeLuminance('#ff0000')!).toBeGreaterThan(relativeLuminance('#0000ff')!);
  });
});
