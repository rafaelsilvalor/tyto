// @vitest-environment jsdom
import { createEditor } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import {
  type Artwork,
  type Diagnostic,
  type Template,
  lineColumnAt,
  paintArtworkList,
  paintProblems,
  paintTemplatePicker,
  rangeOf,
  rangeOfArtwork,
  revealRange,
} from './panel.js';

/**
 * The panel, in the only two ways it can be checked without a screen.
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

const problem = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  severity: 'error',
  code: 'E_UNKNOWN_SLOT',
  message: "'titulo' is not a slot this template declares.",
  range: { start: 24, end: 30 },
  ...over,
});

const BRIEF = ['---', 'template: promo', '---', '::titulo Olá', '::slide', '  Um'].join('\n');

const list = (): HTMLElement => globalThis.document.createElement('div');
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

describe('the problems panel', () => {
  it('shows the code, the message and where to look', () => {
    const node = list();
    paintProblems(node, { diagnostics: [problem()], brief: BRIEF, locale: 'pt-BR' });

    const row = node.querySelector('.problems__row');
    expect(row?.querySelector('.problems__code')?.textContent).toBe('E_UNKNOWN_SLOT');
    expect(row?.querySelector('.problems__message')?.textContent).toContain('titulo');
    // Offset 24 is the `::titulo` line, character 1.
    expect(row?.querySelector('.problems__where')?.textContent).toBe('4:1');
  });

  it('keeps the diagnostic code untranslated, because the docs are indexed by it', () => {
    const node = list();
    paintProblems(node, { diagnostics: [problem()], brief: BRIEF, locale: 'en' });

    expect(node.querySelector('.problems__code')?.textContent).toBe('E_UNKNOWN_SLOT');
  });

  it('says the severity in words as well as in colour', () => {
    // A colour alone is not a severity to somebody who cannot see it.
    const node = list();
    paintProblems(node, {
      diagnostics: [problem({ severity: 'warning' })],
      brief: BRIEF,
      locale: 'pt-BR',
    });

    const dot = node.querySelector('.problems__dot');
    expect(dot?.className).toContain('problems__dot--warning');
    expect(dot?.getAttribute('aria-label')).toBe('Aviso');
  });

  it('makes a row with a range a button, and one without a range not', () => {
    // A diagnostic about the project — an unreadable template folder — is still the reason
    // nothing rendered, so it is listed. There is nowhere for it to take you, so it is not
    // a button: a control that does nothing is worse than no control.
    const node = list();
    paintProblems(node, {
      diagnostics: [problem(), problem({ code: 'E_TEMPLATE_READ', range: undefined })],
      brief: BRIEF,
      locale: 'pt-BR',
    });

    const rows = [...node.querySelectorAll('.problems__row')];
    expect(rows[0]?.tagName).toBe('BUTTON');
    expect(rows[1]?.tagName).toBe('DIV');
    expect(rows[1]?.querySelector('.problems__where')?.textContent).toBe('—');
  });

  it('says so when there is nothing to say', () => {
    const node = list();
    paintProblems(node, { diagnostics: [], brief: BRIEF, locale: 'pt-BR' });

    expect(node.querySelector('.problems__empty')?.textContent).toBe(
      'Nada a relatar sobre este brief',
    );
    expect(node.querySelector('.problems__row')).toBeNull();
  });

  it('reads the range off whatever inside the row was clicked', () => {
    // The click lands on the code or the message nine times out of ten; a handler reading
    // `event.target` alone would work for the tenth.
    const node = list();
    paintProblems(node, { diagnostics: [problem()], brief: BRIEF, locale: 'pt-BR' });

    expect(rangeOf(node.querySelector('.problems__message'))).toEqual({ start: 24, end: 30 });
    expect(rangeOf(node.querySelector('.problems__row'))).toEqual({ start: 24, end: 30 });
    expect(rangeOf(node)).toBeUndefined();
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

describe('the template picker', () => {
  const templates: readonly Template[] = [
    { name: 'cartaz', version: '1.0.0', description: 'One poster', formats: ['feed'] },
    { name: 'promo-curso', version: '2.1.0', formats: ['feed', 'story'] },
  ];

  it('lists the manifests and marks the one the brief names', () => {
    const picker = select();
    paintTemplatePicker(picker, { templates, current: 'promo-curso', locale: 'pt-BR' });

    expect([...picker.options].map((option) => option.value)).toEqual(['cartaz', 'promo-curso']);
    expect(picker.value).toBe('promo-curso');
  });

  it('puts the description and the formats where a reader can see them before choosing', () => {
    const picker = select();
    paintTemplatePicker(picker, { templates, current: 'cartaz', locale: 'pt-BR' });

    expect(picker.options[0]?.title).toBe('One poster — feed');
    // No description is not an empty one: the formats still answer "what will I get".
    expect(picker.options[1]?.title).toBe('feed, story');
  });

  it('offers a placeholder while the brief names no template', () => {
    const picker = select();
    paintTemplatePicker(picker, { templates, current: undefined, locale: 'pt-BR' });

    expect(picker.value).toBe('');
    expect(picker.options[0]?.textContent).toBe('Nenhum');
  });

  it('keeps a template the registry does not have, rather than showing a different one', () => {
    // The brief says what it says. Silently selecting `cartaz` would tell the author their
    // brief uses a template it does not use.
    const picker = select();
    paintTemplatePicker(picker, { templates, current: 'missing-pack', locale: 'pt-BR' });

    expect(picker.options[0]?.textContent).toBe('missing-pack');
    expect(picker.options[0]?.selected).toBe(true);
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
