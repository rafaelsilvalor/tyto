import { declaredSetting, outlineOf } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import { settingContributions } from '../../shared/settings.js';
import { settingsAssist } from './settings-assist.js';

/**
 * Where the cursor is in `settings.json`, and what the tab suggests and explains there
 * (TYTO-304). `|` marks the cursor in each text.
 */

/** The app's settings as main outlines them, with one theme registered. */
const outline = outlineOf(
  settingContributions().map((contribution) => declaredSetting('desktop', false, contribution)),
).map((setting) =>
  setting.key === 'theme'
    ? { ...setting, options: [{ value: 'tyto-light', description: 'Tyto Light, a light theme.' }] }
    : setting,
);
const assist = settingsAssist(
  () => outline,
  () => ({ type: 'Type', default: 'Default', accepted: 'Accepted' }),
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

describe('suggesting in settings.json', () => {
  it('lists every setting not yet written when a key is started', () => {
    const answer = complete('{\n  "|\n}');
    expect(answer?.quoted).toBe(true);
    expect(answer?.from).toBe(5);
    expect(answer?.options).toHaveLength(9);
    expect(labels('{\n  "queueAutoRun": true,\n  "|\n}')).not.toContain('queueAutoRun');
  });

  it('completes a key with its default, selected, and a comma before the next key', () => {
    const vim = complete('{\n  "vimMo|\n}')?.options.find((each) => each.label === 'vimModeStyle');
    expect(vim?.insert).toBe('"vimModeStyle": "badge"');
    expect(vim?.select).toEqual([16, 23]);
    expect(vim?.info).toMatch(/How the status bar shows vim's mode/u);
    expect(vim?.detail).toBe('"badge"');
    // A default too long to read beside the key is its type instead.
    const items = complete('{\n  "status|\n}')?.options.find(
      (each) => each.label === 'statusBarItems',
    );
    expect(items?.detail).toBe('list of string');
    const before = complete('{\n  "vim|\n  "queueAutoRun": true\n}')?.options.find(
      (each) => each.label === 'vimModeStyle',
    );
    expect(before?.insert).toBe('"vimModeStyle": "badge",');
  });

  it('writes the key alone when its colon is already there', () => {
    const vim = complete('{\n  "vim|": "bar"\n}')?.options.find(
      (each) => each.label === 'vimModeStyle',
    );
    expect(vim?.insert).toBe('"vimModeStyle"');
    expect(vim?.select).toBeUndefined();
  });

  it("lists vimModeStyle's three styles inside its value, with what each does", () => {
    const answer = complete('{\n  "vimModeStyle": "|"\n}');
    expect(answer?.options.map((option) => option.label)).toEqual(['badge', 'border', 'bar']);
    expect(answer?.options[2]).toMatchObject({
      insert: '"bar"',
      info: expect.stringMatching(/whole bar/u),
    });
  });

  it('offers a boolean as true and false, after a letter or when asked', () => {
    expect(labels('{ "queueAutoRun": t| }')).toEqual(['true', 'false']);
    expect(labels('{ "queueAutoRun": | }', true)).toEqual(['true', 'false']);
    expect(complete('{ "queueAutoRun": | }')).toBeNull();
  });

  it('offers the registered themes as theme values', () => {
    expect(labels('{ "theme": "|" }')).toEqual(['tyto-light']);
  });

  it('offers the status bar ids not already in the list', () => {
    const shown = labels('{ "statusBarItems": ["leftArea", "|"] }');
    expect(shown).toHaveLength(12);
    expect(shown).not.toContain('leftArea');
  });

  it("offers statusBarColors' member names, with an empty colour to fill in", () => {
    const answer = complete('{ "statusBarColors": { "background": "#000000", "|" } }');
    expect(answer?.options.map((option) => option.label)).not.toContain('background');
    const insert = answer?.options.find((option) => option.label === 'vimMode.insert');
    expect(insert).toMatchObject({ insert: '"vimMode.insert": ""', select: [19, 19] });
  });

  it('offers nothing after a comma, for an unknown key, or with no outline yet', () => {
    expect(complete('{ "queueAutoRun": true,| }')).toBeNull();
    expect(complete('{ "nobody": "|" }')).toBeNull();
    const empty = settingsAssist(
      () => [],
      () => ({ type: '', default: '', accepted: '' }),
    );
    expect(empty.complete('{ "|" }', 3, false)?.options ?? []).toEqual([]);
  });
});

describe('hover help in settings.json', () => {
  const hover = (marked: string) => {
    const { text, position } = at(marked);
    return assist.hover(text, position);
  };

  it('explains a key: description, type, default and the accepted values', () => {
    const answer = hover('{ "vimMo|deStyle": "bar" }');
    expect(answer).toMatchObject({ from: 2, to: 16, title: 'vimModeStyle' });
    expect(answer?.facts).toEqual([
      { label: 'Type', value: 'string' },
      { label: 'Default', value: '"badge"' },
      { label: 'Accepted', value: '"badge", "border", "bar"' },
    ]);
  });

  it("lists statusBarColors' accepted keys", () => {
    const facts = hover('{ "statusBar|Colors": {} }')?.facts ?? [];
    expect(facts.find((fact) => fact.label === 'Accepted')?.value).toContain('"vimMode.normal"');
  });

  it('explains a member name of an object setting', () => {
    expect(hover('{ "statusBarColors": { "backg|round": "#000" } }')).toMatchObject({
      title: 'statusBarColors.background',
      text: "The bar's background.",
    });
  });

  it('says nothing over a value or an unknown key', () => {
    expect(hover('{ "vimModeStyle": "b|ar" }')).toBeNull();
    expect(hover('{ "nob|ody": 1 }')).toBeNull();
  });
});
