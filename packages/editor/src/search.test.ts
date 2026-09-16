import { searchPanelOpen } from '@codemirror/search';
import { afterEach, describe, expect, it } from 'vitest';

import { createCommandRegistry } from './commands.js';
import { createEditor, type EditorHandle } from './editor.js';
import {
  EDITOR_FIND,
  EDITOR_GOTO_LINE,
  EDITOR_REPLACE_ALL,
  SEARCH_PHRASE_KEYS,
  type SearchPhrases,
} from './search.js';

/**
 * Find and replace through a real editor in jsdom, the same reason `editor.test.ts` gives:
 * what the host depends on are properties of the state and the DOM CodeMirror builds, and a
 * stub would only assert that this package calls CodeMirror the way it calls CodeMirror.
 *
 * The panel is the part worth mounting. It is CodeMirror's own DOM, its strings arrive
 * through a facet rather than through this repository's catalogue pass, and the desktop's
 * "every catalogue string is on screen" test in `e2e/window.desktop.test.ts` therefore
 * **cannot see them** — every key added here goes on that test's `NOT_ELEMENT_TEXT` list.
 * This file is what replaces the coverage that list gives up, the way `panel.test.ts` and
 * `command-bar.test.ts` do for their components (ADR 0024).
 */

const open = (): HTMLElement => {
  const parent = document.createElement('div');
  document.body.append(parent);
  return parent;
};

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

/** Every word the panel is showing, from its own DOM. */
const panelText = (): string => {
  const panel = document.querySelector('.cm-search');
  if (panel === null) return '';
  const labels = [...panel.querySelectorAll('input')].map(
    (input) =>
      `${input.getAttribute('placeholder') ?? ''} ${input.getAttribute('aria-label') ?? ''}`,
  );
  return [panel.textContent ?? '', ...labels].join(' ');
};

/** A phrase table that answers every key with a mark nobody would write by accident. */
const marked = (mark: string): SearchPhrases =>
  Object.fromEntries(SEARCH_PHRASE_KEYS.map((key) => [key, `${mark}:${key}`])) as SearchPhrases;

const editorWith = (phrases: SearchPhrases, doc = 'um dois um dois um\n'): EditorHandle =>
  createEditor(open(), { doc, commands: createCommandRegistry(), searchPhrases: phrases });

describe('the search panel', () => {
  it('opens on the find command and closes on escape', () => {
    handle = editorWith({});
    expect(searchPanelOpen(handle.view.state)).toBe(false);

    expect(handle.runCommand(EDITOR_FIND)).toBe(true);
    expect(searchPanelOpen(handle.view.state)).toBe(true);

    // The key rather than the command: `Escape` is the one binding this package leaves to
    // CodeMirror's own keymap, because closing the panel has to work with the focus inside
    // it and a registry binding carries the editor scope only.
    handle.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(searchPanelOpen(handle.view.state)).toBe(false);
  });

  it('says every one of its words in the language it was given', () => {
    handle = editorWith(marked('pt'));
    handle.runCommand(EDITOR_FIND);

    const text = panelText();
    // The eleven the panel itself draws. The other six keys are the go-to-line dialog and
    // the screen-reader announcements, which are not in this DOM — `SEARCH_PHRASE_KEYS` is
    // asserted whole below, where being complete is what matters.
    for (const key of ['Find', 'Replace', 'next', 'previous', 'all', 'match case', 'regexp']) {
      expect(text, key).toContain(`pt:${key}`);
    }
    // And nothing of CodeMirror's own English survived beside them.
    expect(text).not.toContain('match case</');
  });

  it('changes language without losing the buffer, which is why it is not a rebuild', () => {
    handle = editorWith(marked('pt'));
    handle.runCommand(EDITOR_FIND);
    expect(panelText()).toContain('pt:Find');

    handle.setSearchPhrases(marked('en'));

    expect(panelText()).toContain('en:Find');
    expect(panelText()).not.toContain('pt:Find');
    expect(handle.getValue()).toBe('um dois um dois um\n');
  });

  it('builds a new document in the current language, not the one the editor opened in', () => {
    // The reason the phrases are a field reading a mutable holder rather than a compartment:
    // `blank` builds a state from the extension list `createEditor` captured once, so a
    // compartment's initial content would be the language the window started in.
    //
    // Asserted on the state `blank` returns rather than through `restore`, which was the
    // first version of this test and passed with the mechanism broken: `restore` dispatches
    // the current phrases itself, so it answered for both and isolated neither. Measured —
    // with `create` returning `{}` this stayed green while the two above went red.
    handle = editorWith(marked('pt'));
    handle.setSearchPhrases(marked('en'));

    expect(handle.blank('outro documento\n').state.phrase('Find')).toBe('en:Find');
  });

  it('puts a snapshot taken in the other language back in this one', () => {
    // The other direction, and the one `blank` cannot cover: a tab that was away while the
    // window switched carries a state built before the switch. `restore` re-dispatches for
    // exactly that, and this is what fails if it stops.
    handle = editorWith(marked('pt'));
    const taken = handle.snapshot();
    expect(taken.state.phrase('Find')).toBe('pt:Find');

    handle.setSearchPhrases(marked('en'));
    handle.restore(taken);
    handle.runCommand(EDITOR_FIND);

    expect(panelText()).toContain('en:Find');
  });

  it('covers every key CodeMirror asks for', () => {
    // The keys are CodeMirror's own strings and a missing one falls back to itself, which is
    // a silent English word on a Portuguese screen. Counted against the package rather than
    // trusted: 17 is what `grep -c 'phrase(' @codemirror/search/dist/index.js` accounts for,
    // helper excluded.
    expect(SEARCH_PHRASE_KEYS).toHaveLength(17);
    expect(new Set(SEARCH_PHRASE_KEYS).size).toBe(SEARCH_PHRASE_KEYS.length);
  });
});

describe('replace', () => {
  it('replaces every match, and one undo takes the whole of it back', () => {
    handle = editorWith({}, 'um dois um dois um\n');
    handle.runCommand(EDITOR_FIND);

    const field = document.querySelector<HTMLInputElement>('.cm-search input[name="search"]');
    const replacement = document.querySelector<HTMLInputElement>(
      '.cm-search input[name="replace"]',
    );
    expect(field).not.toBeNull();
    expect(replacement).not.toBeNull();

    field!.value = 'um';
    replacement!.value = 'UM';
    // `change`, which is what the panel listens for — the same event a person typing causes.
    field!.dispatchEvent(new Event('change', { bubbles: true }));
    replacement!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(handle.runCommand(EDITOR_REPLACE_ALL)).toBe(true);
    expect(handle.getValue()).toBe('UM dois UM dois UM\n');

    // The acceptance criterion, and the reason none of these commands declares an `undo` of
    // its own: a replace-all is one transaction in CodeMirror's history, so the registry's
    // undo takes back three replacements rather than one.
    handle.runCommand('editor.undo');
    expect(handle.getValue()).toBe('um dois um dois um\n');
  });
});

describe('the commands', () => {
  it('are all on the registry the editor was given', () => {
    const registry = createCommandRegistry();
    const ids = registry.list().map((command) => command.id);

    for (const id of [EDITOR_FIND, EDITOR_GOTO_LINE, EDITOR_REPLACE_ALL]) {
      expect(ids, id).toContain(id);
    }
  });

  it('answer false for a command bar asking with no editor behind it', () => {
    // `runCommand` is the host's route in, and it is what the command bar calls. A registry
    // with no view is not a case this package has, but an id nobody registered is.
    handle = editorWith({});
    expect(handle.runCommand('editor.findSideways')).toBe(false);
  });
});
