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
  isUnsaved,
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
 * so what this file holds is a stand-in that answers `textOf` and nothing else — which is
 * enough, because `textOf` is also the only read `documents.ts` makes. What is tested here is
 * the part that decides what a person sees — which tab is in front after a close, which one a
 * key lands on, whether the empty tab the app opens on may be replaced, and whether a tab is
 * showing the unsaved dot.
 *
 * `editor.test.ts` in `packages/editor` is where the states themselves are proved against a
 * real editor, buffer, history and all, `onUpdate` included — which is what makes the field
 * below the document of record rather than a copy taken at a hand-off (D1, TYTO-115).
 */

/**
 * A stand-in for an `EditorState`, which is opaque outside `@tyto/editor`.
 *
 * It answers `textOf` and nothing else, because `textOf` is the only read that package
 * offers and therefore the only one `documents.ts` is able to make. Distinct objects per
 * call, so the tests that assert a state survived a change can do it by identity.
 *
 * A class and not an object literal with a `toString` on it: a function property is equal
 * only to itself, so two fixtures built the same way would fail the `toEqual` comparisons
 * below for a reason that has nothing to do with the rule under test.
 */
class FakeDocument {
  constructor(private readonly text: string) {}
  toString(): string {
    return this.text;
  }
}

const state = (text: string): EditorState =>
  ({ doc: new FakeDocument(text) }) as unknown as EditorState;

/** A document holding nothing, in no file — the tab the window opens on. */
const doc = (id: string, over: Partial<DocumentState> = {}): DocumentState => ({
  ...newDocument(id, state('')),
  ...over,
});

/** Two briefs, only ever compared with each other — the content is not the point. */
const FIRST = ['---', 'template: promo-curso', '---', '::titulo Campanha'].join('\n');
const SECOND = ['---', 'template: promo-curso', '---', '::titulo Promo'].join('\n');

/** A document whose buffer says `text` and whose file says `savedText`. */
const holding = (id: string, text: string, savedText: string): DocumentState => ({
  ...newDocument(id, state(text)),
  savedText,
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
    const after = updateDocument(before, 'a', (item) => ({ ...item, name: 'campanha.brief' }));

    expect(documentOf(after, 'a')?.name).toBe('campanha.brief');
    expect(documentOf(after, 'b')).toBe(documentOf(before, 'b'));
    // The state is replaced rather than mutated, which is what lets a repaint compare.
    expect(documentOf(before, 'a')?.name).toBeUndefined();
  });

  it('is a no-op for a document that has been closed under it', () => {
    // A preview answer can land after its tab is gone; `request` in `main.ts` relies on
    // this rather than checking first.
    const after = updateDocument(three(), 'gone', (item) => ({ ...item, name: 'gone.brief' }));
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

describe('the unsaved marker', () => {
  it('is off for a brief that has never been typed in', () => {
    expect(isUnsaved(doc('a'))).toBe(false);
  });

  it('is off for a file that was just read, because the two say the same thing', () => {
    expect(isUnsaved(holding('a', FIRST, FIRST))).toBe(false);
  });

  it('comes on when the buffer and the file stop saying the same thing', () => {
    expect(isUnsaved(holding('a', `${FIRST} primeira`, FIRST))).toBe(true);
  });

  it('goes off again when an undo puts the saved text back', () => {
    // **The card, in one assertion.** Under the stored flag this document was unsaved: the
    // flag went on at the first keystroke and only a save took it off, so undoing back to
    // the file left the dot on saying the opposite of the truth. There is no flag to leave
    // behind now — the two strings are equal, so the answer is no (TYTO-112).
    const typed = holding('a', `${FIRST} primeira`, FIRST);
    const undone = { ...typed, state: state(FIRST) };

    expect(isUnsaved(typed)).toBe(true);
    expect(isUnsaved(undone)).toBe(false);
  });

  it('is off before CodeMirror is mounted, which is one paint wide', () => {
    // `main.ts` builds the workspace at module load and creates the editor after the dock
    // has arranged, so the first document exists for a paint with no state in it. Nothing
    // has been typed into a document that has never been shown.
    expect(isUnsaved(newDocument('a'))).toBe(false);
  });

  describe('on a tab that lost its file (TYTO-104, ADR 0026)', () => {
    const released = (text: string): DocumentState =>
      // What `releaseDocument` leaves behind: no name, nothing to compare against.
      ({ ...holding('a', text, FIRST), name: undefined, savedText: '' });

    it('is on while it holds a character, because that text is in no file', () => {
      expect(isUnsaved(released(FIRST))).toBe(true);
    });

    it('is off when it holds none, because there is nothing in it to lose', () => {
      // The shape this card chose, stated where it can be read: an empty tab in no file is
      // the tab the window opens on, however it got there. The two rejected shapes are in
      // ADR 0026 — one would leave this tab claiming a file another tab now owns, the other
      // would put the dot on every untitled tab in the window.
      expect(isUnsaved(released(''))).toBe(false);
    });
  });

  it('is off for an untitled tab that was typed in and then emptied', () => {
    // The same rule as the released tab above and not a second one: neither is in a file,
    // both hold nothing, and the comparison cannot tell them apart.
    expect(isUnsaved(holding('a', '', ''))).toBe(false);
  });
});

describe('the empty tab the window opens on', () => {
  it('may be replaced, because there is nothing in it to lose', () => {
    expect(isDisposable(doc('a'))).toBe(true);
  });

  it('may not, the moment it has a name or any text at all', () => {
    expect(isDisposable(doc('a', { name: 'campanha.brief' }))).toBe(false);
    expect(isDisposable(holding('a', '::titulo Oi', ''))).toBe(false);
  });

  it('may, for a tab that lost its file and was then emptied', () => {
    // The one behaviour this card changed here, pinned where it can be seen. A stored
    // `dirty: true` kept a released tab out of this rule for good; a comparison lets it back
    // in the moment there is nothing in it, and the `brief` left over from its last compile
    // does not hold it open either (ADR 0026).
    const released: DocumentState = {
      ...holding('a', '', ''),
      name: undefined,
      brief: '::titulo Campanha',
    };

    expect(isDisposable(released)).toBe(true);
  });

  it('may, when the last compile said something and the buffer no longer does', () => {
    // The clause that was dropped, and the one behaviour that changed with it. It used to
    // read `brief === ''` because text put into a buffer without a keystroke left the
    // stored `dirty` false — so the last compiled text was the only witness. A derived
    // marker sees the buffer itself, and this document's buffer is empty: there is nothing
    // in it to lose, whatever it said two hundred milliseconds ago (TYTO-112).
    expect(isDisposable(doc('a', { brief: '::titulo Oi' }))).toBe(true);
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
    documents: [
      { ...holding('a', FIRST, FIRST), name: 'campanha.brief' },
      { ...holding('b', SECOND, SECOND), name: 'promo.brief' },
    ],
    activeId: 'b',
  });

  it('takes the name off and empties the text it compares against', () => {
    const after = releaseDocument(held(), 'a');

    expect(documentOf(after, 'a')?.name).toBeUndefined();
    // Not a marker: the tab is unsaved because its text now differs from the empty string,
    // which is what a document in no file compares against (ADR 0026).
    expect(documentOf(after, 'a')?.savedText).toBe('');
  });

  it('keeps every character, the state and the brief it already had', () => {
    // The whole reason the path moves rather than the text: a released tab is somebody's
    // work, and the only thing that stopped being true about it is where it is stored.
    const before = {
      ...holding('a', FIRST, FIRST),
      name: 'campanha.brief',
      brief: '::titulo Campanha',
    };
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
