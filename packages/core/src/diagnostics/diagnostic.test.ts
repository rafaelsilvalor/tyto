import { describe, expect, it } from 'vitest';

import { diagnostic, hasErrors, isError, isWarning, sortDiagnostics } from './diagnostic.js';
import { sourceRange } from '../source/range.js';

const unknownSlot = (slot: string) =>
  diagnostic('E_UNKNOWN_SLOT', { slot, template: 'promo-curso', declared: 'titulo' });

describe('diagnostic', () => {
  it('takes severity and wording from the catalog, not from the caller', () => {
    const item = unknownSlot('titluo');

    expect(item.severity).toBe('error');
    expect(item.code).toBe('E_UNKNOWN_SLOT');
    expect(item.message).toBe("Unknown slot 'titluo'. Template 'promo-curso' declares: titulo.");
  });

  it('reads a warning severity from the catalog too', () => {
    const item = diagnostic('W_UNUSED_SLOT', { slot: 'cor', template: 'promo-curso' });

    expect(item.severity).toBe('warning');
    expect(isWarning(item)).toBe(true);
    expect(isError(item)).toBe(false);
  });

  it('omits range and hint entirely rather than setting them undefined', () => {
    const item = unknownSlot('titluo');

    expect('range' in item).toBe(false);
    expect('hint' in item).toBe(false);
  });

  it('carries a range and a hint when given them', () => {
    const range = sourceRange(10, 16);
    const item = diagnostic(
      'E_ASSET_NOT_FOUND',
      { path: './prof-ana.png', base: '/briefs' },
      { range, hint: 'Check the path relative to the brief.' },
    );

    expect(item.range).toEqual(range);
    expect(item.hint).toBe('Check the path relative to the brief.');
  });
});

describe('hasErrors', () => {
  it('is false for warnings alone, which is what lets a warning ride on success', () => {
    expect(hasErrors([diagnostic('W_UNUSED_SLOT', { slot: 'cor', template: 'x' })])).toBe(false);
  });

  it('is true as soon as one error appears', () => {
    expect(
      hasErrors([diagnostic('W_UNUSED_SLOT', { slot: 'cor', template: 'x' }), unknownSlot('a')]),
    ).toBe(true);
  });

  it('is false for an empty list', () => {
    expect(hasErrors([])).toBe(false);
  });
});

describe('sortDiagnostics', () => {
  it('orders by position, the way a reader scans the file', () => {
    const late = diagnostic(
      'W_UNUSED_SLOT',
      { slot: 'cor', template: 'x' },
      { range: sourceRange(80, 83) },
    );
    const early = diagnostic(
      'E_UNKNOWN_SLOT',
      { slot: 'a', template: 'x', declared: 'b' },
      { range: sourceRange(4, 9) },
    );

    expect(sortDiagnostics([late, early]).map((item) => item.code)).toEqual([
      'E_UNKNOWN_SLOT',
      'W_UNUSED_SLOT',
    ]);
  });

  it('puts positionless diagnostics last, since there is nowhere to look for them', () => {
    const positioned = unknownSlot('a');
    const floating = diagnostic('E_PERMISSION', { plugin: 'p', capability: 'fetch' });

    expect(sortDiagnostics([floating, { ...positioned, range: sourceRange(1, 2) }])[0]?.code).toBe(
      'E_UNKNOWN_SLOT',
    );
  });

  it('breaks a positionless tie by severity, then by code', () => {
    const warning = diagnostic('W_UNUSED_SLOT', { slot: 'cor', template: 'x' });
    const error = diagnostic('E_PERMISSION', { plugin: 'p', capability: 'fetch' });

    expect(sortDiagnostics([warning, error]).map((item) => item.code)).toEqual([
      'E_PERMISSION',
      'W_UNUSED_SLOT',
    ]);
  });

  it('does not mutate its input', () => {
    const items = [
      diagnostic('W_UNUSED_SLOT', { slot: 'cor', template: 'x' }, { range: sourceRange(9, 10) }),
      unknownSlot('a'),
    ];
    const before = [...items];

    sortDiagnostics(items);

    expect(items).toEqual(before);
  });
});
