import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { jsonLanguage } from './json-language.js';

/**
 * The colours of a settings file (TYTO-256), read as the editor would paint them: through the
 * highlight tags the theme styles, by class name here so the test names what it means.
 */
const named = tagHighlighter([
  { tag: tags.propertyName, class: 'key' },
  { tag: tags.string, class: 'string' },
  { tag: tags.number, class: 'number' },
  { tag: tags.atom, class: 'atom' },
  { tag: tags.comment, class: 'comment' },
  { tag: tags.punctuation, class: 'punctuation' },
]);

const spans = (source: string): [string, string][] => {
  const found: [string, string][] = [];
  highlightTree(jsonLanguage.parser.parse(source), named, (from, to, tag) => {
    found.push([source.slice(from, to), tag]);
  });
  return found;
};

describe('the JSONC colours', () => {
  it('tells a key from a value, and colours numbers, literals and both comments', () => {
    const source = [
      '// Tyto settings',
      '{',
      '  "theme": "Tyto Dark", /* why */',
      '  "queueAutoRun": true,',
      '  "editor.fontSize": -1.5e2,',
      '  "queueFolder": null',
      '}',
      '',
    ].join('\n');

    expect(spans(source)).toEqual([
      ['// Tyto settings', 'comment'],
      ['{', 'punctuation'],
      ['"theme"', 'key'],
      [':', 'punctuation'],
      ['"Tyto Dark"', 'string'],
      [',', 'punctuation'],
      ['/* why */', 'comment'],
      ['"queueAutoRun"', 'key'],
      [':', 'punctuation'],
      ['true', 'atom'],
      [',', 'punctuation'],
      ['"editor.fontSize"', 'key'],
      [':', 'punctuation'],
      ['-1.5e2', 'number'],
      [',', 'punctuation'],
      ['"queueFolder"', 'key'],
      [':', 'punctuation'],
      ['null', 'atom'],
      ['}', 'punctuation'],
    ]);
  });

  it('keeps a block comment open across lines, and an escaped quote inside a string', () => {
    const source = '[\n  /* one\n  two */ { "key": "a \\" b" }\n]\n';

    expect(spans(source)).toEqual([
      ['[', 'punctuation'],
      ['/* one', 'comment'],
      // The indent is inside the comment, so it is the comment's.
      ['  two */', 'comment'],
      ['{', 'punctuation'],
      ['"key"', 'key'],
      [':', 'punctuation'],
      ['"a \\" b"', 'string'],
      ['}', 'punctuation'],
      [']', 'punctuation'],
    ]);
  });
});
