import { type EditorState } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import {
  type DocumentState,
  type Workspace,
  activeOf,
  addDocument,
  closeDocument,
  documentAtSlot,
  documentOf,
  isDisposable,
  isStale,
  newDocument,
  releaseDocument,
  selectDocument,
  stepDocument,
  updateDocument,
  workspaceOf,
} from './documents.js';

/**
 * The workspace, driven as the value it is (E9.11).
 *
 * No DOM and no CodeMirror: an `EditorState` is opaque to everything outside `@tyto/editor`,
 * so a marker object is as much of one as this file can meaningfully hold. What is tested
 * here is the part that decides what a person sees — which tab is in front after a close,
 * which one a key lands on, and whether the empty tab the app opens on may be replaced.
 *
 * `editor.test.ts` in `packages/editor` is where the states themselves are proved against a
 * real editor, buffer, history and all, `onUpdate` included — which is what makes the field
 * below the document of record rather than a copy taken at a hand-off (D1, TYTO-115).
 */

const state = (mark: string): EditorState => ({ mark }) as unknown as EditorState;

const doc = (id: string, over: Partial<DocumentState> = {}): DocumentState => ({
  ...newDocument(id, state(id)),
  ...over,
});

const three = (): Workspace => ({
  documents: [doc('a'), doc('b'), doc('c')],
  activeId: 'b',
});

const ids = (workspace: Workspace): string[] => workspace.documents.map((item) => item.id);

describe('what is in front', () => {
  it('is the document the id names', () => {
    expect(activeOf(three()).id).toBe('b');
  });

  it('falls back to the first rather than to nothing', () => {
    // Unreachable by construction, and total on purpose: every caller would otherwise be
    // written against an `undefined` that cannot happen.
    expect(activeOf({ ...three(), activeId: 'gone' }).id).toBe('a');
  });

  it('moves to a document that exists and ignores one that does not', () => {
    expect(selectDocument(three(), 'c').activeId).toBe('c');
    expect(selectDocument(three(), 'z').activeId).toBe('b');
  });
});

describe('changing one document', () => {
  it('leaves every other one alone, and its own object identity behind', () => {
    const before = three();
    const after = updateDocument(before, 'a', (item) => ({ ...item, dirty: true }));

    expect(documentOf(after, 'a')?.dirty).toBe(true);
    expect(documentOf(after, 'b')).toBe(documentOf(before, 'b'));
    // The state is replaced rather than mutated, which is what lets a repaint compare.
    expect(documentOf(before, 'a')?.dirty).toBe(false);
  });

  it('is a no-op for a document that has been closed under it', () => {
    // A preview answer can land after its tab is gone; `request` in `main.ts` relies on
    // this rather than checking first.
    const after = updateDocument(three(), 'gone', (item) => ({ ...item, dirty: true }));
    expect(ids(after)).toEqual(['a', 'b', 'c']);
  });
});

describe('opening another one', () => {
  it('puts it at the end of the strip and in front', () => {
    const after = addDocument(three(), doc('d'));

    expect(ids(after)).toEqual(['a', 'b', 'c', 'd']);
    expect(after.activeId).toBe('d');
  });
});

describe('the empty tab the window opens on', () => {
  it('may be replaced, because there is nothing in it to lose', () => {
    expect(isDisposable(doc('a'))).toBe(true);
  });

  it('may not, the moment it has a name, a keystroke or any text at all', () => {
    expect(isDisposable(doc('a', { name: 'campanha.brief' }))).toBe(false);
    expect(isDisposable(doc('a', { dirty: true }))).toBe(false);
    // The third is the one a `dirty` check alone would miss: text restored into a buffer
    // does not notify anybody, so a document can hold a brief and be clean.
    expect(isDisposable(doc('a', { brief: '::titulo Oi' }))).toBe(false);
  });
});

describe('closing a tab', () => {
  it('hands the window to the tab that took its place', () => {
    const after = closeDocument(three(), 'b', () => doc('fresh'));

    expect(ids(after)).toEqual(['a', 'c']);
    // `c` moved into `b`'s position, which is the tab now under the pointer.
    expect(after.activeId).toBe('c');
  });

  it('hands it to the left when the last tab is the one that went', () => {
    const after = closeDocument({ ...three(), activeId: 'c' }, 'c', () => doc('fresh'));

    expect(after.activeId).toBe('b');
  });

  it('does not move the window when the tab that went was not in front', () => {
    const after = closeDocument(three(), 'a', () => doc('fresh'));

    expect(ids(after)).toEqual(['b', 'c']);
    expect(after.activeId).toBe('b');
  });

  it('leaves an empty document rather than an empty window', () => {
    // Closing everything has to leave somewhere to type: a window with no document has no
    // buffer, and typing is the state this app opens in.
    const after = closeDocument(workspaceOf(doc('only')), 'only', () => doc('fresh'));

    expect(ids(after)).toEqual(['fresh']);
    expect(after.activeId).toBe('fresh');
  });

  it('is a no-op for a tab that is not there', () => {
    expect(closeDocument(three(), 'z', () => doc('fresh'))).toEqual(three());
  });
});

describe('stepping and slots', () => {
  it('wraps at both ends rather than refusing', () => {
    expect(stepDocument(three(), 1)).toBe('c');
    expect(stepDocument(three(), -1)).toBe('a');
    expect(stepDocument({ ...three(), activeId: 'c' }, 1)).toBe('a');
    expect(stepDocument({ ...three(), activeId: 'a' }, -1)).toBe('c');
  });

  it('stays put with one tab open, which is a key that does nothing rather than one that errs', () => {
    expect(stepDocument(workspaceOf(doc('only')), 1)).toBe('only');
  });

  it('counts slots from one, and answers nothing past the last tab', () => {
    expect(documentAtSlot(three(), 1)?.id).toBe('a');
    expect(documentAtSlot(three(), 3)?.id).toBe('c');
    expect(documentAtSlot(three(), 4)).toBeUndefined();
  });
});

describe('letting go of a file another tab saved over', () => {
  /**
   * TYTO-104's bundled loose end, from the side the strip is painted from.
   *
   * Main decides *which* tab lets go and `src/main/documents.test.ts` proves it stops
   * holding the path; what this rule decides is the part a person sees, and it lives here
   * rather than in `main.ts` so that it can be driven without a window.
   */
  const held = (): Workspace => ({
    documents: [doc('a', { name: 'campanha.brief' }), doc('b', { name: 'promo.brief' })],
    activeId: 'b',
  });

  it('takes the name off and marks it unsaved, because its text is now in no file', () => {
    const after = releaseDocument(held(), 'a');

    expect(documentOf(after, 'a')?.name).toBeUndefined();
    expect(documentOf(after, 'a')?.dirty).toBe(true);
  });

  it('keeps every character, the state and the brief it already had', () => {
    // The whole reason the path moves rather than the text: a released tab is somebody's
    // work, and the only thing that stopped being true about it is where it is stored.
    const before = doc('a', { name: 'campanha.brief', brief: '::titulo Campanha' });
    const after = releaseDocument({ documents: [before], activeId: 'a' }, 'a');

    expect(documentOf(after, 'a')?.brief).toBe('::titulo Campanha');
    // By identity: losing a file must not cost the undo history, and the document of record
    // is what carries it.
    expect(documentOf(after, 'a')?.state).toBe(before.state);
  });

  it('leaves every other tab exactly as it was, the active one included', () => {
    const after = releaseDocument(held(), 'a');

    expect(documentOf(after, 'b')).toEqual(documentOf(held(), 'b'));
    expect(after.activeId).toBe('b');
  });

  it('ignores an id nobody has, rather than refusing', () => {
    // Main answers with `released: null` on almost every save, and the renderer guards on
    // that — but a rule that threw on a stale id would turn a save that worked into an
    // error about bookkeeping.
    expect(releaseDocument(held(), 'z')).toEqual(held());
  });
});

/**
 * The stale marker, which is a comparison and not a flag (E9.13).
 *
 * The four cases are the card's acceptance criteria in the order it lists them, and the
 * fourth is the one worth having: a brief that has **never** rendered is not stale, it is
 * empty, and a marker that could not tell those apart would greet a new tab with "older than
 * the text you are writing".
 */
describe('isStale', () => {
  const rendered = (frames: number, renderedBrief: string, brief: string): DocumentState => ({
    ...newDocument('a'),
    frames: Array.from({ length: frames }, () => ({
      artwork: 'artwork-1',
      format: 'feed',
      width: 1080,
      height: 1080,
      html: '<html></html>',
    })),
    renderedBrief,
    brief,
  });

  it('is false while the artwork matches the text', () => {
    expect(isStale(rendered(1, '::titulo Oi', '::titulo Oi'))).toBe(false);
  });

  it('is true once the text has moved on from the artwork', () => {
    expect(isStale(rendered(1, '::titulo Oi', '::titulo Oi!'))).toBe(true);
  });

  it('is false again when the two meet, with nothing to clear', () => {
    // The second acceptance criterion: fixing the brief clears the marker on the next
    // answer. Nothing resets anything — the comparison simply stops being true.
    expect(isStale(rendered(1, '::titulo Oi!', '::titulo Oi!'))).toBe(false);
  });

  it('is false for a brief that has never rendered, which is empty rather than stale', () => {
    expect(isStale(rendered(0, '', 'anything at all'))).toBe(false);
    expect(isStale(newDocument('a'))).toBe(false);
  });
});
