// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createEditor, type EditorHandle } from './editor.js';
import { activeGuide, guideRuns, indentColumns, indentLevels } from './indent-guides.js';

/** A brief with a two-level block, a blank line inside it and one between two blocks. */
const BRIEF = [
  '::lamina', //            0
  '  titulo: Um', //        1
  '  ::item', //            2
  '    texto: a', //        3
  '', //                    4  inside the block: keeps level 2
  '    texto: b', //        5
  '  fim: x', //            6
  '', //                    7  between two blocks: level 0
  '::lamina', //            8
  '  titulo: Dois', //      9
];

const levelsOf = (lines: readonly string[]): readonly number[] => indentLevels(lines, 2, 4);

describe('indentColumns', () => {
  it('counts spaces, and a tab to the next stop', () => {
    expect(indentColumns('    a', 4)).toBe(4);
    expect(indentColumns(' \ta', 4)).toBe(4);
    expect(indentColumns('a', 4)).toBe(0);
  });

  it('says nothing about a line that is whitespace only', () => {
    expect(indentColumns('', 4)).toBeNull();
    expect(indentColumns('   ', 4)).toBeNull();
  });
});

describe('indentLevels', () => {
  it('measures each line in indent units', () => {
    expect(levelsOf(BRIEF)).toEqual([0, 1, 1, 2, 2, 2, 1, 0, 0, 1]);
  });

  it('gives a blank line the lower of its neighbours, so a guide crosses it inside a block', () => {
    expect(levelsOf(['  a', '', '  b'])).toEqual([1, 1, 1]);
    expect(levelsOf(['    a', '', '  b'])).toEqual([2, 1, 1]);
    expect(levelsOf(['  a', '', '', 'b'])).toEqual([1, 0, 0, 0]);
  });

  it('counts a missing neighbour as the top level', () => {
    expect(levelsOf(['', '  a', ''])).toEqual([0, 1, 0]);
  });

  it('rounds a part of a unit down', () => {
    expect(levelsOf(['   a'])).toEqual([1]);
  });
});

describe('guideRuns', () => {
  it('draws one guide per level per run of lines at least that deep', () => {
    expect(guideRuns(levelsOf(BRIEF))).toEqual([
      { level: 1, first: 1, last: 6 },
      { level: 2, first: 3, last: 5 },
      { level: 1, first: 9, last: 9 },
    ]);
  });

  it('draws nothing for a text with no indentation', () => {
    expect(guideRuns(levelsOf(['a', '', 'b']))).toEqual([]);
  });
});

describe('activeGuide', () => {
  const levels = levelsOf(BRIEF);

  it('is the guide of the block holding the cursor', () => {
    expect(activeGuide(levels, 4)).toEqual({ level: 2, first: 3, last: 5 });
    expect(activeGuide(levels, 6)).toEqual({ level: 1, first: 1, last: 6 });
  });

  it('is the guide of the block a line opens, on the line that opens it', () => {
    expect(activeGuide(levels, 0)).toEqual({ level: 1, first: 1, last: 6 });
    expect(activeGuide(levels, 2)).toEqual({ level: 2, first: 3, last: 5 });
  });

  it('is none at the top level, where no block holds the cursor', () => {
    expect(activeGuide(levels, 7)).toBeNull();
    expect(activeGuide(levelsOf(['a', 'b']), 1)).toBeNull();
  });
});

/** The layer the guides are drawn in; jsdom does no layout, so its children are not asked. */
const layerOf = (editor: EditorHandle): Element | null =>
  editor.view.dom.querySelector('.cm-indent-guides');

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const mount = (indentGuides?: boolean): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, {
    doc: BRIEF.join('\n'),
    ...(indentGuides === undefined ? {} : { indentGuides }),
  });
  return handle;
};

describe('the indentGuides option', () => {
  it('draws the guides by default', () => {
    expect(layerOf(mount())).not.toBeNull();
  });

  it('draws none when it is off', () => {
    expect(layerOf(mount(false))).toBeNull();
  });

  it('turns them off and on again in place, keeping the text and the history', () => {
    const editor = mount();
    editor.view.dispatch({ changes: { from: 0, insert: '// ' } });
    editor.setIndentGuides(false);
    expect(layerOf(editor)).toBeNull();
    editor.setIndentGuides(true);
    expect(layerOf(editor)).not.toBeNull();
    expect(editor.getValue().startsWith('// ::lamina')).toBe(true);
  });

  it('brings a tab built before the switch up to it when the tab is shown', () => {
    const editor = mount();
    const json = editor.blank('{\n  "a": 1\n}', 'json');
    editor.setIndentGuides(false);
    editor.restore(json);
    expect(layerOf(editor)).toBeNull();
    const later = editor.blank('x');
    editor.setIndentGuides(true);
    editor.restore(later);
    expect(layerOf(editor)).not.toBeNull();
  });
});
