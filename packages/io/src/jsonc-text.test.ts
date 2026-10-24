import { describe, expect, it } from 'vitest';

import { type JsoncTextOptions, readJsoncText } from './jsonc-text.js';

const OPTIONS: JsoncTextOptions = {
  syntaxCode: 'E_PROJECT_SYNTAX',
  notAnObject: 'it is not an object of keys',
};

describe('readJsoncText', () => {
  it('points a syntax error at the token the parser stopped on', () => {
    const text = '{ "output": "out" "assets": [] }';
    const read = readJsoncText(text, OPTIONS);
    const start = text.indexOf('"assets"');
    expect(read.syntax).toEqual([
      {
        severity: 'error',
        code: 'E_PROJECT_SYNTAX',
        message: 'The project file cannot be read here: comma expected.',
        range: { start, end: start + '"assets"'.length },
      },
    ]);
    expect(read.entries.map((entry) => entry.key)).toEqual(['output', 'assets']);
  });

  it('keeps the offsets of the file when it starts with a byte order mark', () => {
    const text = '﻿{ "output": "out" }';
    const read = readJsoncText(text, OPTIONS);
    const start = text.indexOf('"output"');
    expect(read.syntax).toEqual([]);
    expect(read.entries[0]?.keyRange).toEqual({ start, end: start + '"output"'.length });
  });

  it('gives an object value its tree, members and items all the way down', () => {
    const text = '{ "preset": { "sizes": [1, 2] } }';
    const read = readJsoncText(text, OPTIONS);
    const sizes = read.entries[0]?.node?.members?.[0];
    expect(sizes?.key).toBe('sizes');
    expect(
      sizes?.value?.items?.map((item) => text.slice(item.range.start, item.range.end)),
    ).toEqual(['1', '2']);
  });
});
