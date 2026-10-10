import { describe, expect, it } from 'vitest';

import { readKeybindingsText } from './keybindings-file.js';

/** `keybindings.json` read as text a person wrote (TYTO-207, ADR 0074). */
describe('readKeybindingsText', () => {
  it('reads entries with comments and a trailing comma, each with its range', () => {
    const text = [
      '// mine',
      '[',
      '  { "key": "ctrl+shift+e", "command": "file.export" },',
      '  { "key": "ctrl+n", "command": "-document.new", "when": "mode.desktop" },',
      ']',
    ].join('\n');

    const read = readKeybindingsText(text);

    expect(read.syntax).toEqual([]);
    expect(read.entries.map(({ key, command, when }) => ({ key, command, when }))).toEqual([
      { key: 'ctrl+shift+e', command: 'file.export', when: undefined },
      { key: 'ctrl+n', command: '-document.new', when: 'mode.desktop' },
    ]);
    const first = read.entries[0]?.range;
    expect(first === undefined ? '' : text.slice(first.start, first.end)).toBe(
      '{ "key": "ctrl+shift+e", "command": "file.export" }',
    );
  });

  it('reads an empty or blank file as no entries and no problem', () => {
    expect(readKeybindingsText('')).toEqual({ entries: [], syntax: [] });
    expect(readKeybindingsText('  \n')).toEqual({ entries: [], syntax: [] });
  });

  it('says a text that does not parse is a syntax error, at the place', () => {
    const read = readKeybindingsText('[\n  { "key": "ctrl+e" "command": "x" }\n]');

    expect(read.syntax.map((problem) => problem.code)).toContain('E_KEYBINDINGS_SYNTAX');
    expect(read.syntax[0]?.range?.start).toBeGreaterThan(0);
  });

  it('says an object at the top is not a list', () => {
    const read = readKeybindingsText('{ "ctrl+e": "file.export" }');

    expect(read.entries).toEqual([]);
    expect(read.syntax.map((problem) => problem.message)).toEqual([
      'The keybindings file cannot be read here: it is not a list of keybindings.',
    ]);
  });

  it('says an entry without a string key or command is not one, and reads the others', () => {
    const read = readKeybindingsText(
      '[{ "key": 1, "command": "x" }, { "key": "ctrl+e" }, { "key": "ctrl+e", "command": "y" }]',
    );

    expect(read.syntax).toHaveLength(2);
    expect(read.entries.map((entry) => entry.command)).toEqual(['y']);
  });
});
