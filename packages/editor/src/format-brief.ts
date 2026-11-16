import { isolateHistory } from '@codemirror/commands';
import { getIndentUnit, indentUnit } from '@codemirror/language';
import { type Extension, EditorState } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { formatBriefEdits } from '@tyto/brief-lang';
import { type Diagnostics, type Result, ok, slotDepth } from '@tyto/core';

import { briefAnalysisField } from './analysis.js';

/**
 * Format Brief in a view (TYTO-297, ADR 0096): `@tyto/brief-lang`'s edits, applied as one
 * transaction.
 *
 * Edits and not the formatted text, so the selection maps through them: a caret inside a line
 * whose indent moved stays on the same character, and one in a removed blank line lands on the
 * line after. One transaction with its own history event, so one Ctrl+Z puts the whole brief
 * back, never half of it, and never merged with the typing just before.
 *
 * The indent comes from the state — the unit `tabSize` sets through {@link indentExtension} —
 * so what Tab inserts and what this re-indents to cannot disagree. The nesting comes from the
 * manifest the brief's last analysis named (ADR 0207): each directive is indented by its depth
 * in the template's tree. With no analysis yet, every directive goes to column 0.
 *
 * `ok(true)` when the text changed, `ok(false)` when it was already in shape, and the syntax
 * errors when the brief cannot be formatted: then nothing is dispatched.
 */
export function formatBriefInView(view: EditorView): Result<boolean, Diagnostics> {
  const manifest = view.state.field(briefAnalysisField, false)?.manifest;
  const edits = formatBriefEdits(view.state.doc.toString(), {
    indentUnit: getIndentUnit(view.state),
    ...(manifest === undefined ? {} : { depthOf: (name: string) => slotDepth(manifest, name) }),
  });
  if (!edits.ok) return edits;
  if (edits.value.length === 0) return ok(false);
  view.dispatch({
    changes: edits.value.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
    userEvent: 'format',
    annotations: isolateHistory.of('full'),
    scrollIntoView: false,
  });
  return ok(true);
}

/** The narrowest and widest indent `tabSize` accepts; the desktop's schema holds the same. */
export const MIN_TAB_SIZE = 1;
export const MAX_TAB_SIZE = 8;
export const DEFAULT_TAB_SIZE = 2;

/**
 * What `tabSize` means to CodeMirror: the indent unit — what Tab inserts and Shift+Tab takes
 * away, in spaces — and the width a tab character is drawn at. The indent guides read both,
 * so their step follows (TYTO-293).
 */
export function indentExtension(tabSize: number): Extension {
  const size = Math.min(Math.max(Math.trunc(tabSize), MIN_TAB_SIZE), MAX_TAB_SIZE);
  return [indentUnit.of(' '.repeat(size)), EditorState.tabSize.of(size)];
}
