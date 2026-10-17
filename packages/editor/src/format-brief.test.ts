// @vitest-environment jsdom
import { indentMore, undo } from '@codemirror/commands';
import { getIndentUnit } from '@codemirror/language';
import { Compartment, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { type EditorHandle, createEditor } from './editor.js';
import { formatBriefInView, indentExtension } from './format-brief.js';
import { indentLevels, unitChanged } from './indent-guides.js';

/**
 * Format Brief in a view and the `tabSize` option (TYTO-297, ADR 0096).
 *
 * What the language rewrites is `@tyto/brief-lang`'s to test; here, that the editor applies it
 * as one undoable change that keeps the caret on its text, refuses a broken brief without
 * touching it, and that `tabSize` drives Tab, the guides and the indent Format Brief writes —
 * live, in every pane and in a tab shown later.
 */

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const mount = (doc: string, tabSize?: number): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, { doc, ...(tabSize === undefined ? {} : { tabSize }) });
  return handle;
};

const MESSY = '::lamina   \n\n\tORTOPEDISTA  \n      Profª. Mara Rebeiro\n\n\n\n   Segunda\n';

describe('formatBriefInView', () => {
  it('formats the brief in one change that one undo takes back', () => {
    const editor = mount(MESSY);
    const result = formatBriefInView(editor.view);
    expect(result).toEqual({ ok: true, value: true, diagnostics: [] });
    expect(editor.getValue()).toBe('::lamina\n  ORTOPEDISTA\n  Profª. Mara Rebeiro\n\n  Segunda\n');
    expect(undo(editor.view)).toBe(true);
    expect(editor.getValue()).toBe(MESSY);
  });

  it('keeps the caret on the character it was on', () => {
    const editor = mount(MESSY);
    const at = MESSY.indexOf('Rebeiro') + 2;
    editor.view.dispatch({ selection: EditorSelection.cursor(at) });
    formatBriefInView(editor.view);
    const head = editor.view.state.selection.main.head;
    expect(editor.view.state.sliceDoc(head - 2, head + 5)).toBe('Rebeiro');
  });

  it('does not join the typing just before it in the undo history', () => {
    const editor = mount('::titulo A');
    editor.view.dispatch({
      changes: { from: 10, insert: '  ' },
      userEvent: 'input.type',
    });
    formatBriefInView(editor.view);
    expect(editor.getValue()).toBe('::titulo A\n');
    undo(editor.view);
    expect(editor.getValue()).toBe('::titulo A  ');
  });

  it('says so and changes nothing when the brief is already formatted', () => {
    const editor = mount('::lamina\n  a\n');
    expect(formatBriefInView(editor.view)).toEqual({ ok: true, value: false, diagnostics: [] });
    expect(undo(editor.view)).toBe(false);
  });

  it('refuses a brief with a syntax error, and leaves it as it was', () => {
    const broken = '::titulo **aberto\n   corpo   \n';
    const editor = mount(broken);
    const result = formatBriefInView(editor.view);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.map((item) => item.code)).toContain('E_SYNTAX');
    expect(editor.getValue()).toBe(broken);
    expect(undo(editor.view)).toBe(false);
  });
});

describe('the tabSize option', () => {
  it('is 2 by default: Tab inserts two spaces, and Format Brief indents by two', () => {
    const editor = mount('::lamina\n      a\n');
    expect(getIndentUnit(editor.view.state)).toBe(2);
    expect(editor.view.state.tabSize).toBe(2);
    formatBriefInView(editor.view);
    expect(editor.getValue()).toBe('::lamina\n  a\n');
  });

  it('at 4: Tab inserts four spaces, Format Brief indents by four, the guides step by four', () => {
    const editor = mount('x\n', 4);
    editor.view.dispatch({ selection: EditorSelection.cursor(0) });
    indentMore(editor.view);
    expect(editor.getValue()).toBe('    x\n');

    const brief = mount('::lamina\n  a\n\tb\n', 4);
    formatBriefInView(brief.view);
    expect(brief.getValue()).toBe('::lamina\n    a\n    b\n');
    // The guides read the same state: four columns, or one tab, are one level; two are none.
    const { state } = brief.view;
    expect(
      indentLevels(
        ['::lamina', '    a', '        b', '\tc', '  d'],
        getIndentUnit(state),
        state.tabSize,
      ),
    ).toEqual([0, 1, 2, 1, 0]);
  });

  it('changes live in every pane and in a tab shown later, keeping text and history', () => {
    const editor = mount('::lamina\n      a\n');
    const second = document.createElement('div');
    document.body.append(second);
    const pane = editor.createPane(second);
    const later = editor.blank('y\n');

    editor.setTabSize(4);
    expect(getIndentUnit(editor.view.state)).toBe(4);
    expect(getIndentUnit(pane.view.state)).toBe(4);
    expect(editor.view.state.tabSize).toBe(4);
    formatBriefInView(editor.view);
    expect(editor.getValue()).toBe('::lamina\n    a\n');
    expect(undo(editor.view)).toBe(true);

    editor.restore(later);
    expect(getIndentUnit(editor.view.state)).toBe(4);
    editor.view.dispatch({ selection: EditorSelection.cursor(0) });
    indentMore(editor.view);
    expect(editor.getValue()).toBe('    y\n');

    editor.setTabSize(2);
    indentMore(editor.view);
    expect(editor.getValue()).toBe('      y\n');
  });
});

describe('the guides and a tabSize change', () => {
  it('redraw when the unit or the tab width moves, with no edit to go with it', () => {
    const compartment = new Compartment();
    const seen: boolean[] = [];
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement('div')),
      doc: '::lamina\n    a\n',
      extensions: [
        compartment.of(indentExtension(2)),
        EditorView.updateListener.of((update) => {
          if (update.transactions.length > 0) seen.push(unitChanged(update));
        }),
      ],
    });
    view.dispatch({ effects: compartment.reconfigure(indentExtension(4)) });
    view.dispatch({ selection: EditorSelection.cursor(1) });
    view.dispatch({ effects: compartment.reconfigure(indentExtension(4)) });
    expect(seen).toEqual([true, false, false]);
    view.destroy();
  });
});
