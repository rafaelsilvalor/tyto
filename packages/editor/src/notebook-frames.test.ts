// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type NotebookFrame,
  notebookFrameOf,
  notebookFrames,
  refreshNotebookFrames,
} from './notebook-frames.js';

/**
 * A notebook's blocks framed over the one editor (TYTO-676), read from the DOM the view built:
 * each `.cm-line`'s classes, and the toolbar inside a block's first line.
 */

const DOC = ['# a note', '# two lines', 'acme.pull', '', 'where status = done'].join('\n');

/** Frames as a host reads them: a run of `#` lines, and each other non-blank line. */
function framesOf(view: EditorView, label: () => string): readonly NotebookFrame[] {
  const frames: NotebookFrame[] = [];
  const { doc } = view.state;
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    if (line.text === '') continue;
    const note = line.text.startsWith('#');
    const previous = frames.at(-1);
    if (note && previous?.kind === 'note' && doc.lineAt(previous.to).number === number - 1) {
      frames[frames.length - 1] = { ...previous, to: line.to };
      continue;
    }
    frames.push({
      from: line.from,
      to: line.to,
      kind: note ? 'note' : 'step',
      key: `${line.text}:${label()}`,
      toolbar: () => {
        builds += 1;
        const toolbar = document.createElement('span');
        toolbar.textContent = label();
        return toolbar;
      },
    });
  }
  return frames;
}

let view: EditorView | undefined;
let builds = 0;

afterEach(() => {
  view?.destroy();
  view = undefined;
  builds = 0;
});

const open = (label: () => string = () => 'tools'): EditorView => {
  view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [notebookFrames({ framesOf: (on) => framesOf(on, label) })],
    }),
    parent: document.body,
  });
  return view;
};

/** Each line's text, as the DOM holds it, and the frame classes it carries. */
const lines = (on: EditorView): [string, string][] =>
  [...on.contentDOM.querySelectorAll('.cm-line')].map((line) => {
    const classes = [...line.classList]
      .filter((name) => name.startsWith('cm-notebook-frame'))
      .map((name) => name.replace('cm-notebook-frame', '') || 'frame');
    return [line.textContent ?? '', classes.join(' ')];
  });

/** The toolbars once the layer has drawn: it draws on CodeMirror's next measure. */
async function toolbars(on: EditorView): Promise<HTMLElement[]> {
  await new Promise((done) => setTimeout(done, 50));
  return [...on.dom.querySelectorAll<HTMLElement>('.cm-notebook-toolbar')];
}

describe('a notebook framed over the editor (TYTO-676)', () => {
  it('frames each block, first and last line marked, and leaves a blank line out', () => {
    const on = open();
    expect(lines(on)).toEqual([
      ['# a note', 'frame --note --first --active'],
      ['# two lines', 'frame --note --last --active'],
      ['acme.pull', 'frame --step --first --last'],
      ['', ''],
      ['where status = done', 'frame --step --first --last'],
    ]);
  });

  // The toolbar is beside the text, never in it: a line's text is the line's alone.
  it('draws one toolbar per block outside the text, each standing for its block', async () => {
    const on = open();
    const drawn = await toolbars(on);
    expect(drawn.every((toolbar) => !on.contentDOM.contains(toolbar))).toBe(true);
    expect(on.contentDOM.textContent).not.toContain('tools');
    expect(drawn.map((toolbar) => toolbar.closest('.cm-notebook-toolbars') !== null)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      drawn.map((toolbar) => {
        const frame = notebookFrameOf(on, toolbar);
        return frame === undefined ? '' : on.state.doc.lineAt(frame.from).text;
      }),
    ).toEqual(['# a note', 'acme.pull', 'where status = done']);
    // Its buttons are the person's: the layer is not hidden from a screen reader.
    expect(on.dom.querySelector('.cm-notebook-toolbars')?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('finds the block a toolbar stands for as the text is after an edit', async () => {
    const on = open();
    const [, pull] = await toolbars(on);
    on.dispatch({ changes: { from: 0, insert: 'acme.first\n' } });
    const frame = pull === undefined ? undefined : notebookFrameOf(on, pull);
    // Index 1 is now `# a note`'s frame: the toolbars are drawn again on the next measure.
    expect(frame === undefined ? '' : on.state.doc.lineAt(frame.from).text).toBe('# a note');
    const again = await toolbars(on);
    const texts = again.map((toolbar) => {
      const found = notebookFrameOf(on, toolbar);
      return found === undefined ? '' : on.state.doc.lineAt(found.from).text;
    });
    expect(texts).toEqual(['acme.first', '# a note', 'acme.pull', 'where status = done']);
  });

  it('marks the block holding the caret, and follows the caret', () => {
    const on = open();
    on.dispatch({ selection: EditorSelection.cursor(on.state.doc.line(5).from) });
    expect(lines(on).map(([, classes]) => classes.includes('--active'))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('reads the blocks again after an edit, from the text as it is', () => {
    const on = open();
    on.dispatch({ changes: { from: on.state.doc.line(4).from, insert: 'acme.tag' } });
    expect(lines(on).map(([, classes]) => classes)).toEqual([
      'frame --note --first --active',
      'frame --note --last --active',
      'frame --step --first --last',
      'frame --step --first --last',
      'frame --step --first --last',
    ]);
  });

  it('keeps a toolbar whose key stays, and builds anew on a refresh that changes it', async () => {
    let label = 'tools';
    const on = open(() => label);
    await toolbars(on);
    const before = builds;
    on.dispatch({ selection: EditorSelection.cursor(on.state.doc.line(3).from) });
    await toolbars(on);
    expect(builds).toBe(before);

    label = 'folded';
    on.dispatch({ effects: refreshNotebookFrames.of(null) });
    const drawn = await toolbars(on);
    expect(builds).toBe(before + 3);
    expect(drawn.map((toolbar) => toolbar.textContent)).toEqual(['folded', 'folded', 'folded']);
  });
});
