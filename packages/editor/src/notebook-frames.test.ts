// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type NotebookFrame,
  edgeScrollSpeed,
  enterNotebookCommand,
  isNotebookCommandTarget,
  leaveNotebookCommand,
  nearestDrop,
  notebookDragOf,
  notebookFrameOf,
  notebookFrames,
  notebookInsertOf,
  refreshNotebookFrames,
  selectedNotebookFrame,
  setNotebookDrag,
  stepNotebookSelection,
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

// TYTO-676, second pull request: a "+" on each boundary, and the counter in a gutter.
describe('inserting between blocks and the counter', () => {
  const STEPS = ['acme.pull', 'acme.tag', 'where status = done'].join('\n');
  let mark = 'ran';

  const openSteps = (): EditorView => {
    const stepFrames = (on: EditorView): readonly NotebookFrame[] =>
      [1, 2, 3].map((number) => {
        const line = on.state.doc.line(number);
        return {
          from: line.from,
          to: line.to,
          kind: 'step',
          key: line.text,
          insertable: number > 1,
          marker: { text: number === 1 ? `[${mark}]` : '[ ]', className: 'mark', title: 'why' },
        };
      });
    view = new EditorView({
      state: EditorState.create({
        doc: STEPS,
        extensions: [
          notebookFrames({
            framesOf: stepFrames,
            insert: () => {
              const control = document.createElement('button');
              control.textContent = '+';
              return control;
            },
          }),
        ],
      }),
      parent: document.body,
    });
    return view;
  };

  it('draws a "+" above each insertable block and one below the last, outside the text', async () => {
    const on = openSteps();
    await new Promise((done) => setTimeout(done, 50));
    const controls = [...on.dom.querySelectorAll<HTMLElement>('.cm-notebook-insert')];
    expect(controls.every((control) => !on.contentDOM.contains(control))).toBe(true);
    expect(
      controls.map((control) => {
        const place = notebookInsertOf(on, control);
        return place === 'end' || place === undefined
          ? place
          : on.state.doc.lineAt(place.from).text;
      }),
    ).toEqual(['acme.tag', 'where status = done', 'end']);
    expect(on.contentDOM.textContent).not.toContain('+');
  });

  it("shows each block's marker in the gutter on its first line, and follows a refresh", () => {
    mark = 'ran';
    const on = openSteps();
    const gutterText = () =>
      [...on.dom.querySelectorAll('.cm-notebook-gutter .cm-gutterElement .mark')].map(
        (each) => each.textContent,
      );
    expect(gutterText()).toEqual(['[ran]', '[ ]', '[ ]']);
    expect(on.dom.querySelector('.cm-notebook-gutter .mark')?.getAttribute('title')).toBe('why');

    mark = '7';
    on.dispatch({ effects: refreshNotebookFrames.of(null) });
    expect(gutterText()).toEqual(['[7]', '[ ]', '[ ]']);
  });
});

// TYTO-676, third pull request: command mode is focus on the toolbars' layer, a block selected.
describe('command mode', () => {
  const openNotebook = (): EditorView => {
    view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [notebookFrames({ framesOf: (on) => framesOf(on, () => 'tools') })],
      }),
      parent: document.body,
    });
    return view;
  };
  const selectedText = (on: EditorView): string | undefined => {
    const frame = selectedNotebookFrame(on);
    return frame === undefined ? undefined : on.state.doc.lineAt(frame.from).text;
  };

  it('selects the block at the caret and moves focus off the text, onto its target', () => {
    const on = openNotebook();
    on.focus();
    on.dispatch({ selection: EditorSelection.cursor(on.state.doc.line(5).from + 3) });
    expect(enterNotebookCommand(on)).toBe(true);
    expect(selectedText(on)).toBe('where status = done');
    expect(isNotebookCommandTarget(document.activeElement)).toBe(true);
    expect(on.contentDOM.contains(document.activeElement)).toBe(false);
    expect(lines(on).map(([, classes]) => classes.includes('--selected'))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('steps between blocks, stops at the ends, and follows its block through an edit', () => {
    const on = openNotebook();
    enterNotebookCommand(on, 0);
    expect(selectedText(on)).toBe('# a note');
    expect(stepNotebookSelection(on, 1)).toBe(true);
    expect(selectedText(on)).toBe('acme.pull');
    expect(stepNotebookSelection(on, -1)).toBe(true);
    expect(stepNotebookSelection(on, -1)).toBe(false);
    stepNotebookSelection(on, 1);
    on.dispatch({ changes: { from: 0, insert: 'acme.first\n' } });
    expect(selectedText(on)).toBe('acme.pull');
  });

  it('leaves when focus goes back into the text, as a click there puts it', () => {
    const on = openNotebook();
    enterNotebookCommand(on, 0);
    on.focus();
    expect(selectedNotebookFrame(on)).toBeUndefined();
  });

  it('leaves for the text with the caret where it is asked, and nothing selected', () => {
    const on = openNotebook();
    enterNotebookCommand(on, 0);
    const at = on.state.doc.line(3).to;
    leaveNotebookCommand(on, at);
    expect(selectedNotebookFrame(on)).toBeUndefined();
    expect(on.state.selection.main.head).toBe(at);
    expect(on.hasFocus).toBe(true);
  });
});

// TYTO-676, fourth pull request: a block dragged by its grip, with pointer events.
describe('dragging a block by its grip', () => {
  /** DOC's frames, every one movable but the first, which stands for a header. */
  function openDraggable() {
    const move = vi.fn<(view: EditorView, from: number, before: number | 'end') => void>();
    view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [
          notebookFrames({
            framesOf: (on) =>
              framesOf(on, () => 'tools').map((frame, index) => ({
                ...frame,
                movable: index > 0,
              })),
            move,
            gripLabel: () => 'Drag to move',
          }),
        ],
      }),
      parent: document.body,
    });
    const on = view;
    const grips = () => [...on.dom.querySelectorAll<HTMLElement>('.cm-notebook-grip')];
    /** Presses frame `index`'s grip, its pointer capture stubbed: jsdom has none. */
    const press = (index: number) => {
      const grip = grips().find((each) => each.dataset['notebookGrip'] === String(index));
      if (grip === undefined) throw new Error(`no grip for frame ${String(index)}`);
      let captured = false;
      const release = vi.fn(() => {
        captured = false;
      });
      Object.assign(grip, {
        setPointerCapture: () => {
          captured = true;
        },
        hasPointerCapture: () => captured,
        releasePointerCapture: release,
      });
      const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperty(down, 'pointerId', { value: 7 });
      grip.dispatchEvent(down);
      return { grip, release };
    };
    const dragged = () =>
      [...on.contentDOM.querySelectorAll('.cm-notebook-frame--dragged')].map(
        (line) => line.textContent,
      );
    return { on, move, grips, press, dragged };
  }

  it('puts a grip on each movable frame, none on the first, saying what it does', () => {
    const { grips } = openDraggable();
    expect(grips().map((grip) => grip.dataset['notebookGrip'])).toEqual(['1', '2']);
    expect(grips().map((grip) => grip.getAttribute('aria-label'))).toEqual([
      'Drag to move',
      'Drag to move',
    ]);
  });

  it('picks the drop place nearest the pointer', () => {
    const places = [
      { before: 1, top: 100 },
      { before: 2, top: 140 },
      { before: 'end' as const, top: 200 },
    ];
    expect(nearestDrop(places, 90)?.before).toBe(1);
    expect(nearestDrop(places, 125)?.before).toBe(2);
    expect(nearestDrop(places, 999)?.before).toBe('end');
    expect(nearestDrop([], 10)).toBeUndefined();
  });

  it('drags: dims the block, and on release hands the host the move and frees the pointer', () => {
    const { on, move, press, dragged } = openDraggable();
    const { grip, release } = press(1);
    expect(notebookDragOf(on)).toEqual({ from: 1, before: null });
    expect(dragged()).toEqual(['acme.pull']);
    on.dispatch({ effects: setNotebookDrag.of({ from: 1, before: 'end' }) });
    grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(move).toHaveBeenCalledWith(on, 1, 'end');
    expect(release).toHaveBeenCalledWith(7);
    expect(notebookDragOf(on)).toBeNull();
    expect(dragged()).toEqual([]);
  });

  it('cancels on Escape and when the window loses focus, freeing the pointer, moving nothing', () => {
    const { on, move, press } = openDraggable();
    const first = press(2);
    on.dispatch({ effects: setNotebookDrag.of({ from: 2, before: 1 }) });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(first.release).toHaveBeenCalledWith(7);
    expect(notebookDragOf(on)).toBeNull();

    const second = press(2);
    window.dispatchEvent(new Event('blur'));
    expect(second.release).toHaveBeenCalledWith(7);
    expect(notebookDragOf(on)).toBeNull();
    second.grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(move).not.toHaveBeenCalled();
  });

  // TYTO-710: the window, not the grip, hears the release, since a far scroll unmounts the grip.
  // Here the release lands on the page's body, as it does once the grip is gone.
  it('drops on a release the window hears off the grip', () => {
    const { on, move, press } = openDraggable();
    press(1);
    on.dispatch({ effects: setNotebookDrag.of({ from: 1, before: 'end' }) });
    document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(move).toHaveBeenCalledWith(on, 1, 'end');
    expect(notebookDragOf(on)).toBeNull();
  });

  // A run can rewrite the text under a drag: the frames it counted are gone, so the drag ends.
  it('cancels when the text changes mid-drag, freeing the pointer, and drops nothing', async () => {
    const { on, move, press } = openDraggable();
    const { grip, release } = press(1);
    on.dispatch({ effects: setNotebookDrag.of({ from: 1, before: 'end' }) });
    on.dispatch({ changes: { from: 0, insert: '# new\n' } });
    expect(notebookDragOf(on)).toBeNull();
    await Promise.resolve();
    expect(release).toHaveBeenCalledWith(7);
    grip.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(move).not.toHaveBeenCalled();
  });
});

// TYTO-710: a drag near the top or bottom of the pane scrolls it.
describe('scrolling the pane while a block is dragged near its edge', () => {
  it('scrolls nowhere outside the bands, faster nearer the edge, and at full speed past it', () => {
    // A pane from 100 to 500: bands 48 px deep.
    expect(edgeScrollSpeed(300, 100, 500)).toBe(0);
    expect(edgeScrollSpeed(148, 100, 500)).toBe(0);
    expect(edgeScrollSpeed(452, 100, 500)).toBe(0);
    expect(edgeScrollSpeed(124, 100, 500)).toBe(-600);
    expect(edgeScrollSpeed(476, 100, 500)).toBe(600);
    expect(edgeScrollSpeed(500, 100, 500)).toBe(1200);
    expect(edgeScrollSpeed(900, 100, 500)).toBe(1200);
    expect(edgeScrollSpeed(-50, 100, 500)).toBe(-1200);
    // A short pane, 100 px: bands of a quarter, 25 px.
    expect(edgeScrollSpeed(170, 100, 200)).toBe(0);
    expect(edgeScrollSpeed(187.5, 100, 200)).toBe(600);
    // No pane: no scroll.
    expect(edgeScrollSpeed(10, 100, 100)).toBe(0);
  });

  const PANE_TOP = 100;
  const PANE_BOTTOM = 200;
  const LINE = 20;
  const SCROLL_LIMIT = 50;

  /**
   * DOC in a pane from 100 to 200 px, each line 20 px, scrolled by a stubbed `scrollTop` that
   * stops at 50: jsdom lays nothing out, so the boxes are computed from it.
   */
  function openScrolling() {
    const move = vi.fn<(view: EditorView, from: number, before: number | 'end') => void>();
    view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [
          notebookFrames({
            framesOf: (on) =>
              framesOf(on, () => 'tools').map((frame, index) => ({
                ...frame,
                movable: index > 0,
              })),
            move,
          }),
        ],
      }),
      parent: document.body,
    });
    const on = view;
    let scrolled = 0;
    Object.defineProperty(on.scrollDOM, 'scrollTop', {
      configurable: true,
      get: () => scrolled,
      set: (value: number) => {
        scrolled = Math.max(0, Math.min(SCROLL_LIMIT, value));
      },
    });
    const box = (top: number, bottom: number) =>
      ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top }) as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this === on.scrollDOM) return box(PANE_TOP, PANE_BOTTOM);
      const index = [...on.contentDOM.querySelectorAll('.cm-line')].indexOf(this);
      if (index === -1) return box(0, 0);
      const top = PANE_TOP + index * LINE - scrolled;
      return box(top, top + LINE);
    });
    const grip = [...on.dom.querySelectorAll<HTMLElement>('.cm-notebook-grip')].find(
      (each) => each.dataset['notebookGrip'] === '1',
    );
    if (grip === undefined) throw new Error('no grip');
    Object.assign(grip, {
      setPointerCapture: () => undefined,
      hasPointerCapture: () => false,
      releasePointerCapture: () => undefined,
    });
    grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    const pointerAt = (clientY: number) => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientY, bubbles: true }));
    };
    return { on, move, pointerAt, scrolled: () => scrolled };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('scrolls down in the bottom band, rests at the end, and starts again back in a band', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { on, pointerAt, scrolled } = openScrolling();
    pointerAt(199);
    vi.advanceTimersByTime(16);
    // 1,152 px a second at 24 px into a 25 px band: 18 px in 16 ms.
    expect(scrolled()).toBeCloseTo(18.4, 1);
    vi.advanceTimersByTime(500);
    expect(scrolled()).toBe(SCROLL_LIMIT);
    // At the end of the scroll no timer spins while the pointer rests past the edge.
    expect(vi.getTimerCount()).toBe(0);

    pointerAt(150);
    expect(vi.getTimerCount()).toBe(0);
    pointerAt(PANE_TOP - 10);
    vi.advanceTimersByTime(16);
    expect(scrolled()).toBeLessThan(SCROLL_LIMIT);
    vi.advanceTimersByTime(500);
    expect(scrolled()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(notebookDragOf(on)).not.toBeNull();
  });

  it('stops scrolling when the drag is cancelled', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { on, move, pointerAt, scrolled } = openScrolling();
    pointerAt(199);
    vi.advanceTimersByTime(16);
    const before = scrolled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(500);
    expect(scrolled()).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
    expect(notebookDragOf(on)).toBeNull();
    expect(move).not.toHaveBeenCalled();
  });

  it('picks the drop place again under a still pointer when the pane scrolls, as by the wheel', () => {
    const { on, pointerAt } = openScrolling();
    // Line 3 (acme.pull) starts at 140: the place above frame 1.
    pointerAt(150);
    expect(notebookDragOf(on)?.before).toBe(1);
    // Scrolled 40 px, line 5 (where …) starts at 140: the place above frame 2.
    on.scrollDOM.scrollTop = 40;
    on.scrollDOM.dispatchEvent(new Event('scroll'));
    expect(notebookDragOf(on)?.before).toBe(2);
  });
});
