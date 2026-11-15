import { StateEffect } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';

/**
 * Says that a view has just read its text's size again (TYTO-272): what the indent guides and
 * the pinned head lines redraw on, since a new character width alone moves no geometry
 * CodeMirror reports.
 */
export const textRemeasured = StateEffect.define<null>();

/**
 * Makes the view's next measure read the heights of the lines in view again (`true`), or that
 * and the text's size too (`'refresh'`). CodeMirror's own flag for it, `mustMeasureContent`, is
 * internal, so it is set only where it exists, and `remeasure.test.ts` fails the day an upgrade
 * renames it. Without it, a measure reads the heights only when the content box changed height,
 * which a block that shrinks inside a box held at `min-height: 100%` never does (TYTO-703).
 */
export function markContentForMeasure(view: EditorView, value: true | 'refresh'): void {
  const internal = view as unknown as { viewState?: { mustMeasureContent?: boolean | 'refresh' } };
  const viewState = internal.viewState;
  if (viewState !== undefined && 'mustMeasureContent' in viewState) {
    viewState.mustMeasureContent = value;
  }
}

/** Whether `update` carries {@link textRemeasured}. */
export function wasRemeasured(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(textRemeasured)),
  );
}

/**
 * Makes a view read its text's size again on its next measure — the line height and the width
 * of a character — and tells everything drawn from them (TYTO-272, ADR 0099).
 *
 * The host changes the editor's face and size through custom properties, which CodeMirror does
 * not watch. Asked to measure, it re-reads the size only when it meets a line height it has not
 * seen, so a new face at the same size — the same line height, another character width — leaves
 * the old width in place. The one door that always re-reads is the one CodeMirror opens itself
 * when the document's fonts finish loading: `mustMeasureContent = "refresh"`. It is internal, so
 * it is set only where it exists, and `remeasure.test.ts` fails the day an upgrade renames it.
 *
 * Even then a width that changed with the line height staying put is no geometry change, so no
 * update follows the measure and the guides keep their old columns — measured, 2 px off at the
 * second level with Consolas for IBM Plex Mono at 20 px. So once the measure has run, a
 * transaction carrying {@link textRemeasured} goes out, after the measure cycle has finished,
 * when a dispatch is allowed again.
 */
export function remeasureText(view: EditorView): void {
  markContentForMeasure(view, 'refresh');
  view.requestMeasure({
    read: () => null,
    write: () => {
      queueMicrotask(() => {
        if (view.dom.isConnected) view.dispatch({ effects: textRemeasured.of(null) });
      });
    },
  });
}
