// @vitest-environment jsdom
import { codeFolding, ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { stickyScroll } from './sticky-scroll.js';
import { template } from './template-language.js';

/**
 * The rows follow the parse, not only the scroll (TYTO-339).
 *
 * A template element folds only once its close tag is parsed, so on a tree the parser has not
 * finished the chain at the top is empty. When the background parse lands, CodeMirror dispatches
 * a transaction that carries the new tree and nothing else — no text, viewport, geometry or
 * selection change — and the layer has to measure again on that alone. On CI the desktop suite
 * caught the layer empty, tree complete, until a synthetic `scroll` drew the rows.
 *
 * jsdom lays nothing out, so the pane's height and its scrolled position are given here: they
 * are inputs to the measure, not what is being tested. What is tested is that the same pane,
 * with the same geometry, draws nothing on a partial tree and the rows once the tree alone
 * changes. The measure is run synchronously, so CodeMirror's own background parse, which runs
 * on a timer, cannot land between the two halves.
 */

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});

/** Three nested elements whose close tags sit past the 3 000 characters the first parse covers. */
const FILLER_LINES = 600;
const DOC = [
  '<div class="page">', //  1
  '  <section>', //         2
  '    <p>', //             3
  ...Array.from({ length: FILLER_LINES }, () => '      um texto'),
  '    </p>',
  '  </section>',
  '</div>',
].join('\n');

type Internal = { measure(): void };

/** CodeMirror's measuring pass, run now: reads every request, then writes them. */
const measureNow = (target: EditorView): void => {
  const internal = target as unknown as Internal;
  // The internal this relies on: if an upgrade renames it, this is the line that says so.
  expect(typeof internal.measure).toBe('function');
  internal.measure();
};

const pinnedLines = (target: EditorView): readonly string[] =>
  [...target.dom.querySelectorAll<HTMLElement>('.cm-sticky-line')].map(
    (row) => row.dataset['line'] ?? '',
  );

const mount = (): EditorView => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const mounted = new EditorView({
    parent,
    doc: DOC,
    extensions: [template(), codeFolding(), stickyScroll()],
  });
  const lineHeight = mounted.defaultLineHeight;
  const scroller = mounted.scrollDOM;
  // A pane tall enough for the rows, scrolled so its top is ten lines down, inside all three.
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 60 * lineHeight });
  const scrolledTop = 10 * lineHeight + mounted.documentTop;
  scroller.getBoundingClientRect = (): DOMRect =>
    ({
      top: scrolledTop,
      bottom: scrolledTop + 60 * lineHeight,
      left: 0,
      right: 800,
      width: 800,
      height: 60 * lineHeight,
      x: 0,
      y: scrolledTop,
      toJSON: () => ({}),
    }) as DOMRect;
  return mounted;
};

/** Finishes the parse on the state's parse context — the state's own tree stays the old one. */
const finishParse = (target: EditorView): void => {
  const end = target.state.doc.length;
  let calls = 0;
  while (ensureSyntaxTree(target.state, end, 0) === null) {
    calls += 1;
    if (calls > 100_000) throw new Error(`the parse did not reach ${String(end)}`);
  }
};

describe('the sticky rows and the background parse', () => {
  it('draws nothing on a partial tree, and the rows once the parse lands', () => {
    view = mount();
    expect(view.defaultLineHeight).toBeGreaterThan(0);
    // The precondition, checked rather than assumed: the first parse stops short of the close tags.
    expect(syntaxTree(view.state).length).toBeLessThan(DOC.indexOf('    </p>'));
    measureNow(view);
    expect(pinnedLines(view)).toEqual([]);

    finishParse(view);
    // A transaction with nothing in it: what promotes the finished tree into the state, as the
    // background parse's own dispatch does.
    view.dispatch({});
    expect(syntaxTree(view.state).length).toBe(DOC.length);
    measureNow(view);
    expect(pinnedLines(view)).toEqual(['1', '2', '3']);
  });
});
