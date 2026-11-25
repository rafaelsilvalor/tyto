import { describe, expect, it } from 'vitest';

import { capitals } from './text.js';

import type { RichText } from '@tyto/core';

describe('capitals', () => {
  it('sets the words in Portuguese capitals and keeps every other inline where it was', () => {
    const value: RichText = [
      { kind: 'text', value: 'programação ', range: { start: 0, end: 12 } },
      { kind: 'break', range: { start: 12, end: 13 } },
      { kind: 'text', value: 'gratuíta', range: { start: 13, end: 21 } },
    ];

    expect(capitals(value)).toEqual([
      { kind: 'text', value: 'PROGRAMAÇÃO ', range: { start: 0, end: 12 } },
      { kind: 'break', range: { start: 12, end: 13 } },
      { kind: 'text', value: 'GRATUÍTA', range: { start: 13, end: 21 } },
    ]);
  });
});
