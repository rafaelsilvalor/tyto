// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { frontmatterRange, swatchDecorations } from './colour-swatch.js';

/**
 * The colour swatches (TYTO-835): a square before each hex colour of a brief's frontmatter,
 * read off the decorations, and drawn in a real view for the DOM it puts beside the code.
 */

function swatches(doc: string): { at: number; colour: string }[] {
  const found: { at: number; colour: string }[] = [];
  swatchDecorations(EditorState.create({ doc })).between(0, doc.length, (from, _to, value) => {
    const widget = value.spec.widget as { colour: string };
    found.push({ at: from, colour: widget.colour });
  });
  return found;
}

const brief = (...lines: string[]): string => ['---', ...lines, '---', '::titulo X', ''].join('\n');

describe('the colour swatches of a frontmatter', () => {
  it('sits before each hex colour, in every form a declared colour takes', () => {
    const doc = brief("destaque: '#e30613'", 'fundo: "#fff"', 'texto: #4d4d4dcc', "faixa: '#ABCD'");
    expect(swatches(doc).map((swatch) => swatch.colour)).toEqual([
      '#e30613',
      '#fff',
      '#4d4d4dcc',
      '#ABCD',
    ]);
    expect(swatches(doc)[0]!.at).toBe(doc.indexOf('#e30613'));
  });

  it('draws none for what is not a colour', () => {
    const doc = brief("a: '#e3061'", "b: '#ggg'", "c: '#1234567'", 'd: x#fff', "e: '#fff1x'");
    expect(swatches(doc)).toEqual([]);
  });

  it('draws none in the body, where #bad and # Nome are words', () => {
    const doc = ['---', "destaque: '#e30613'", '---', '::titulo', '  # Nome #bad #face', ''].join(
      '\n',
    );
    expect(swatches(doc).map((swatch) => swatch.colour)).toEqual(['#e30613']);
  });

  it('draws none without a frontmatter, or with one nobody closed', () => {
    expect(swatches('::titulo #fff\n')).toEqual([]);
    expect(swatches("---\ndestaque: '#fff'\n")).toEqual([]);
    expect(
      frontmatterRange(EditorState.create({ doc: "---\ndestaque: '#fff'\n" })),
    ).toBeUndefined();
  });
});

describe('the swatch in a view', () => {
  let view: EditorView | undefined;
  afterEach(() => view?.destroy());

  it('puts a square of the colour before the code, and follows an edit', async () => {
    const { colourSwatches } = await import('./colour-swatch.js');
    const doc = brief("destaque: '#e30613'");
    view = new EditorView({
      state: EditorState.create({ doc, extensions: [colourSwatches()] }),
      parent: document.body,
    });
    const square = () => view!.dom.querySelector<HTMLElement>('.cm-colourSwatch');
    expect(square()?.style.backgroundColor).toBe('rgb(227, 6, 19)');
    expect(view.state.doc.toString()).toBe(doc);

    const at = doc.indexOf('e30613');
    view.dispatch({ changes: { from: at, to: at + 6, insert: '00a859' } });
    expect(square()?.style.backgroundColor).toBe('rgb(0, 168, 89)');

    view.dispatch({ changes: { from: at, to: at + 6, insert: 'zz' } });
    expect(square()).toBeNull();
  });
});
