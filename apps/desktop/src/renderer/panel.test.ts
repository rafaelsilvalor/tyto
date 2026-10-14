// @vitest-environment jsdom
import { createEditor } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import {
  type Artwork,
  lineColumnAt,
  paintArtworkList,
  rangeOfArtwork,
  revealRange,
} from './panel.js';

/**
 * The pickers and the cursor, in the only two ways they can be checked without a screen.
 *
 * The problems panel moved to `problems-panel.test.ts` with the element itself (ADR 0024).
 *
 * The DOM half is what a node ends up holding, and the cursor half is driven through a
 * **real** editor rather than a double. That is deliberate: the card's criterion is that a
 * click lands *exactly* at the reported range, and a double would only prove that this file
 * and the double agree about what "exactly" means. CodeMirror is what actually decides, so
 * CodeMirror is what answers.
 *
 * jsdom lays nothing out, so how the panel *looks* is not here — it is the end-to-end suite
 * and a real window (TYTO-40 and TYTO-41 each shipped three bugs a green suite could not
 * see).
 */

/**
 * jsdom does not implement `Range.getClientRects`, which CodeMirror's measuring pass calls.
 *
 * The same hole `@tyto/editor`'s own setup file fills, and filled the same way: an empty
 * list is the honest answer, because in jsdom there really is no rectangle. Repeated here
 * rather than shared, because a setup file is per package and this is the one test in this
 * app that builds an editor.
 */
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () => {
    const rects: DOMRect[] = [];
    return Object.assign(rects, { item: () => null }) as unknown as DOMRectList;
  };
}

const BRIEF = ['---', 'template: promo', '---', '::titulo Olá', '::slide', '  Um'].join('\n');

const select = (): HTMLSelectElement => globalThis.document.createElement('select');

describe('turning an offset into a place a person can find', () => {
  it('counts from one, the way a gutter does', () => {
    expect(lineColumnAt('abc', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumnAt('abc', 2)).toEqual({ line: 1, column: 3 });
  });

  it('counts all three line endings as one break each', () => {
    // A brief is a file a person edits and the three endings all reach the parser
    // (`docs/brief-language.md`). Counting `\r\n` twice would report every line of a
    // Windows file as one further down than it is.
    expect(lineColumnAt('a\nb', 2)).toEqual({ line: 2, column: 1 });
    expect(lineColumnAt('a\r\nb', 3)).toEqual({ line: 2, column: 1 });
    expect(lineColumnAt('a\rb', 2)).toEqual({ line: 2, column: 1 });
  });

  it('clamps an offset past the end rather than counting off the edge', () => {
    expect(lineColumnAt('ab', 99)).toEqual({ line: 1, column: 3 });
    expect(lineColumnAt('ab', -5)).toEqual({ line: 1, column: 1 });
  });
});

describe('clicking a problem puts the cursor exactly where it said', () => {
  const editorFor = (doc: string): ReturnType<typeof createEditor> =>
    createEditor(globalThis.document.createElement('div'), { doc });

  it('selects the reported range, to the character', () => {
    // The acceptance criterion. Driven through a real CodeMirror, because CodeMirror is
    // what decides what a selection is — a double would only agree with this file.
    const editor = editorFor(BRIEF);

    revealRange(editor.view, { start: 24, end: 31 });

    const selection = editor.view.state.selection.main;
    expect([selection.from, selection.to]).toEqual([24, 31]);
    expect(editor.view.state.sliceDoc(selection.from, selection.to)).toBe('::titul');
    editor.destroy();
  });

  it('holds a cursor rather than a selection for a zero-width range', () => {
    const editor = editorFor(BRIEF);

    revealRange(editor.view, { start: 24, end: 24 });

    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(editor.view.state.selection.main.from).toBe(24);
    editor.destroy();
  });

  it('clamps a range the buffer has already outgrown', () => {
    // Not defensiveness: the panel shows the answer to the brief as it was compiled, and a
    // keystroke that shortened the document between the request and the click is ordinary.
    // Unclamped, CodeMirror throws inside a click handler.
    const editor = editorFor('short');

    expect(() => {
      revealRange(editor.view, { start: 900, end: 950 });
    }).not.toThrow();
    expect(editor.view.state.selection.main.from).toBe(5);
    editor.destroy();
  });
});

describe('the artwork list', () => {
  const artworks: readonly Artwork[] = [
    { id: 'slide-1', index: 0, range: { start: 40, end: 52 } },
    { id: 'slide-2', index: 1, range: { start: 53, end: 65 } },
  ];

  it('numbers the slides the way a person counts them', () => {
    const picker = select();
    paintArtworkList(picker, { artworks, selected: 'slide-2' });

    expect([...picker.options].map((option) => option.textContent)).toEqual(['1', '2']);
    expect(picker.value).toBe('slide-2');
  });

  it('hands back where in the brief a slide was written', () => {
    expect(rangeOfArtwork(artworks, 'slide-2')).toEqual({ start: 53, end: 65 });
    expect(rangeOfArtwork(artworks, 'slide-9')).toBeUndefined();
    expect(rangeOfArtwork(artworks, undefined)).toBeUndefined();
  });

  it('has no range for an artwork the template did not repeat', () => {
    // A brief whose template has no repeating slot produces one artwork standing for the
    // whole document; there is no single line for the editor to scroll to.
    expect(rangeOfArtwork([{ id: 'artwork-1', index: 0 }], 'artwork-1')).toBeUndefined();
  });
});
