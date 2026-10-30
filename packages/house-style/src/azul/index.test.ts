import { describe, expect, it } from 'vitest';

import * as azul from './index.js';

/**
 * The names the two azul template repositories import. They depend on this entry by version,
 * so dropping or renaming one breaks a template that is not built here.
 */
const IMPORTED_BY_TEMPLATES = {
  'agenda-semana': [
    'accentOfAzul',
    'footer',
    'hasNextSlide',
    'header',
    'coverTitle',
    'sessionTable',
    'ARROW',
    'BAND',
    'CHROME',
    'EDGE',
    'GAP',
    'INK',
    'MARGIN',
    'PAPER',
  ],
  aprovados: [
    'accentOfAzul',
    'footer',
    'hasNextSlide',
    'header',
    'approvedTable',
    'resultTitle',
    'APPROVED',
    'BAND',
    'EDGE',
    'MARGIN',
    'PAPER',
  ],
} as const;

describe('@tyto/house-style/azul', () => {
  for (const [template, names] of Object.entries(IMPORTED_BY_TEMPLATES)) {
    it(`exports every name ${template} imports`, () => {
      const missing = names.filter((name) => !(name in azul));
      expect(missing).toEqual([]);
    });
  }
});
