import type { Diagnostic } from '@tyto/core';
import * as io from '@tyto/io';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readSettingsText } from './settings-file.js';

// The real reader, watched. The shape test below would also hold for two readers that happen
// to agree; this is what says `settings.json` is read by io's reader and not by one of the
// window's own (TYTO-350).
vi.mock('@tyto/io', async (importOriginal) => {
  const actual = await importOriginal<typeof io>();
  return { ...actual, readJsoncText: vi.fn(actual.readJsoncText) };
});

/** A text both files can hold, with one comma missing before `"assets"`. */
const TEXT = '{\n  // a comment\n  "output": "out"\n  "assets": []\n}';
const AT = TEXT.indexOf('"assets"');

/** Everything a diagnostic says but its code and the file named in its message. */
function shapeOf(syntax: readonly Diagnostic[]) {
  return syntax.map((item) => ({
    severity: item.severity,
    problem: item.message.slice(item.message.indexOf(': ') + 2),
    range: item.range,
  }));
}

describe('a syntax error in settings.json and in .tyto/project.json', () => {
  beforeEach(() => {
    vi.mocked(io.readJsoncText).mockClear();
  });

  it('is the same diagnostic, under each file’s own code', () => {
    const settings = readSettingsText(TEXT);
    const project = io.readProjectText(TEXT);

    expect(settings.syntax.map((item) => item.message)).toEqual([
      'The settings file cannot be read here: comma expected.',
    ]);
    expect(project.syntax.map((item) => item.message)).toEqual([
      'The project file cannot be read here: comma expected.',
    ]);
    expect(settings.syntax.map((item) => item.code)).toEqual(['E_SETTINGS_SYNTAX']);
    expect(project.syntax.map((item) => item.code)).toEqual(['E_PROJECT_SYNTAX']);
    const expected = [
      { severity: 'error', problem: 'comma expected.', range: { start: AT, end: AT + 8 } },
    ];
    expect(shapeOf(settings.syntax)).toEqual(expected);
    expect(shapeOf(project.syntax)).toEqual(expected);
  });

  it('is found by the one reader io gives both', () => {
    readSettingsText(TEXT);

    expect(io.readJsoncText).toHaveBeenCalledWith(
      TEXT,
      expect.objectContaining({ syntaxCode: 'E_SETTINGS_SYNTAX' }),
    );
  });
});
