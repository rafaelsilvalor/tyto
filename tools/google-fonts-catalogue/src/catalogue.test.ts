import { describe, expect, it } from 'vitest';

import { buildCatalogue, folderOf, serialiseCatalogue } from './catalogue.ts';

/** The catalogue's shape from a hand-written slice of Google's two sources (TYTO-281). */

const METADATA = {
  familyMetadataList: [
    {
      family: 'Source Sans 3',
      category: 'Sans Serif',
      fonts: { '700': {}, '400i': {}, '400': {} },
    },
    { family: 'Edu Example', category: 'Handwriting', fonts: { '400': {} } },
    { family: 'Abel', category: 'Sans Serif', fonts: { '400': {}, vf: {} } },
  ],
};

describe('the Google Fonts catalogue', () => {
  it('keeps a family with its licence, styles in order, and leaves out one with no licence folder', () => {
    const licences = new Map([
      ['sourcesans3', 'ofl'],
      ['abel', 'ofl'],
    ] as const);
    const { catalogue, unlicensed } = buildCatalogue(METADATA, licences, '2026-10-22');

    expect(catalogue.families).toEqual([
      { family: 'Abel', category: 'Sans Serif', licence: 'ofl', styles: '400' },
      {
        family: 'Source Sans 3',
        category: 'Sans Serif',
        licence: 'ofl',
        styles: '400 400i 700',
      },
    ]);
    expect(unlicensed).toEqual(['Edu Example']);
  });

  it('names a folder the way google/fonts does', () => {
    expect(folderOf('Source Sans 3')).toBe('sourcesans3');
    expect(folderOf('DM Sans')).toBe('dmsans');
  });

  it('writes one family per line', () => {
    const text = serialiseCatalogue({
      generated: '2026-10-22',
      families: [{ family: 'Abel', category: 'Sans Serif', licence: 'ofl', styles: '400' }],
    });
    expect(text.split('\n')).toContain(
      '    {"family":"Abel","category":"Sans Serif","licence":"ofl","styles":"400"}',
    );
    expect(JSON.parse(text)).toMatchObject({ generated: '2026-10-22' });
  });
});
