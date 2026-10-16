import { KEYBINDING_CONTEXTS } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import {
  type KeybindingCommand,
  KEYBINDING_FIELDS,
  keybindingsAssist,
} from './keybindings-assist.js';

/**
 * Where the cursor is in `keybindings.json`, and what the tab suggests and explains there
 * (TYTO-304). `|` marks the cursor in each text.
 */

const COMMANDS: readonly KeybindingCommand[] = [
  { id: 'editor.save', title: 'Save', key: 'Ctrl+S' },
  { id: 'file.export', title: 'Export', key: 'Ctrl+E' },
  { id: 'plugin.thing', title: 'plugin.thing' },
];
const assist = keybindingsAssist(
  () => COMMANDS,
  () => ({ defaultKey: 'Default key' }),
);

const at = (marked: string): { text: string; position: number } => ({
  text: marked.replace('|', ''),
  position: marked.indexOf('|'),
});
const complete = (marked: string, explicit = false) => {
  const { text, position } = at(marked);
  return assist.complete(text, position, explicit);
};
const labels = (marked: string, explicit = false) =>
  complete(marked, explicit)?.options.map((option) => option.label);
const hover = (marked: string) => {
  const { text, position } = at(marked);
  return assist.hover(text, position);
};

describe('suggesting in keybindings.json', () => {
  it('lists the three fields on a quote inside an entry', () => {
    const answer = complete('[\n  { "|\n]');
    expect(answer?.quoted).toBe(true);
    expect(answer?.from).toBe(7);
    expect(answer?.options.map((option) => option.label)).toEqual(['key', 'command', 'when']);
    expect(answer?.options[1]?.info).toMatch(/"-<id>" removes/u);
  });

  it('leaves out a field the entry already has', () => {
    expect(labels('[\n  { "key": "ctrl+e", "|\n]')).toEqual(['command', 'when']);
    expect(labels('[\n  { "key": "ctrl+e", "command": "editor.save", "|" }\n]')).toEqual(['when']);
  });

  it('completes a field with an empty value and the caret between its quotes', () => {
    const command = complete('[\n  { "com|\n]')?.options.find((each) => each.label === 'command');
    expect(command?.insert).toBe('"command": ""');
    expect(command?.select).toEqual([12, 12]);
    // A field already written after it needs a comma.
    const before = complete('[\n  { "|\n    "command": "editor.save" }\n]')?.options.find(
      (each) => each.label === 'key',
    );
    expect(before?.insert).toBe('"key": "",');
    // Just the name, when the colon is already there.
    const named = complete('[\n  { "wh|": "editor" }\n]')?.options.find(
      (each) => each.label === 'when',
    );
    expect(named?.insert).toBe('"when"');
  });

  it('lists every command id with its title, then the removal of each with a default key', () => {
    const answer = complete('[\n  { "key": "ctrl+e", "command": "|" }\n]');
    expect(answer?.quoted).toBe(true);
    expect(answer?.options.map((option) => option.label)).toEqual([
      'editor.save',
      'file.export',
      'plugin.thing',
      '-editor.save',
      '-file.export',
    ]);
    const save = answer?.options[0];
    expect(save?.detail).toBe('Save');
    expect(save?.insert).toBe('"editor.save"');
    expect(save?.info).toBe('Save — Ctrl+S');
    // With no title, the id is the detail.
    expect(answer?.options[2]?.detail).toBe('plugin.thing');
    expect(answer?.options[3]?.insert).toBe('"-editor.save"');
    expect(answer?.options[3]?.info).toMatch(/Removes the default binding of "Save" \(Ctrl\+S\)/u);
  });

  it('lists the six contexts, each with what it means, for when', () => {
    const answer = complete('[\n  { "key": "ctrl+e", "when": "|" }\n]');
    expect(answer?.options.map((option) => option.label)).toEqual([...KEYBINDING_CONTEXTS]);
    expect(answer?.options.find((each) => each.label === 'commandBar')?.info).toBe(
      'The command bar is open.',
    );
    expect(answer?.options[0]?.insert).toBe('"editor"');
  });

  it('suggests nothing for the key itself, outside an entry, or on a comma', () => {
    expect(complete('[\n  { "key": "|" }\n]')).toBeNull();
    expect(complete('[\n  "|\n]')).toBeNull();
    expect(complete('[\n  { "key": "ctrl+e", "x": { "command": "|" } }\n]')).toBeNull();
    expect(complete('[\n  { "key": "ctrl+e",| }\n]')).toBeNull();
    // Asked for by key, the same place lists the fields.
    expect(labels('[\n  { "key": "ctrl+e", | }\n]', true)).toEqual(['command', 'when']);
  });
});

describe('hover in keybindings.json', () => {
  const ENTRY = '[\n  { "key": "ctrl+e", "command": "editor.save", "when": "panel" }\n]';
  const on = (word: string, offset = 2) => {
    const position = ENTRY.indexOf(word) + offset;
    return assist.hover(ENTRY, position);
  };

  it("shows a command's title and its default key on its id", () => {
    const answer = on('editor.save');
    expect(answer?.title).toBe('Save');
    expect(answer?.text).toBe('editor.save');
    expect(answer?.facts).toEqual([{ label: 'Default key', value: 'Ctrl+S' }]);
    expect(answer?.from).toBe(ENTRY.indexOf('"editor.save"'));
  });

  it('says what a removal removes', () => {
    const answer = hover('[\n  { "key": "ctrl+e", "command": "-file.ex|port" }\n]');
    expect(answer?.title).toBe('Export');
    expect(answer?.text).toMatch(/^Removes the default binding of "Export"/u);
  });

  it("shows a context's sentence on a when value", () => {
    expect(on('"panel"')).toMatchObject({
      title: 'panel',
      text: 'Focus is in a panel other than the editor, and the command bar is closed.',
    });
  });

  it('says what each field is on its name', () => {
    for (const field of KEYBINDING_FIELDS) {
      expect(on(`"${field.name}"`)).toMatchObject({ title: field.name, text: field.description });
    }
  });

  it('says nothing over an unknown command, an unknown context, the key or a nested object', () => {
    expect(hover('[\n  { "command": "nope.no|pe" }\n]')).toBeNull();
    expect(hover('[\n  { "when": "every|where" }\n]')).toBeNull();
    expect(hover('[\n  { "key": "ctrl|+e" }\n]')).toBeNull();
    expect(hover('[\n  { "x": { "comm|and": "editor.save" } }\n]')).toBeNull();
  });
});
