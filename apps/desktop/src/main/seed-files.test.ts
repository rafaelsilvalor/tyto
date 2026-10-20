import { type ParseError, parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '../../shared/i18n/index.js';
import { newKeybindingsFile, newSnippetsFile } from './seed-files.js';

/** The file as the app reads it back: JSON with comments, and the errors, which must be none. */
function read(text: string): { value: unknown; errors: ParseError[] } {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  return { value, errors };
}

/** The comment lines only: what changes between languages, and nothing else should. */
const notes = (text: string): string[] => text.split('\n').filter((line) => line.startsWith('//'));

describe('the files the app creates for keybindings and snippets (TYTO-334)', () => {
  it.each(LOCALES)('creates keybindings.json in %s as an empty list under its notes', (locale) => {
    expect(read(newKeybindingsFile(locale))).toEqual({ value: [], errors: [] });
  });

  it.each(LOCALES)('creates snippets.json in %s as an empty object under its notes', (locale) => {
    expect(read(newSnippetsFile(locale))).toEqual({ value: {}, errors: [] });
  });

  it("writes the notes in the window's language, so pt-BR and en differ line for line", () => {
    for (const seed of [newKeybindingsFile, newSnippetsFile]) {
      const portuguese = notes(seed('pt-BR'));
      const english = notes(seed('en'));
      expect(portuguese).toHaveLength(english.length);
      portuguese.forEach((line, index) => {
        expect(line).not.toBe(english[index]);
      });
    }
    expect(newKeybindingsFile('pt-BR')).toMatch(/^\/\/ Atalhos de teclado do Tyto/u);
    expect(newSnippetsFile('pt-BR')).toMatch(/^\/\/ Trechos do Tyto/u);
  });
});
