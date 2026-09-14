import { type Diagnostic as LintDiagnostic } from '@codemirror/lint';
import { type Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import { type Diagnostic } from '@tyto/core';

/**
 * Turning a Tyto `Diagnostic` into a CodeMirror marker, for whichever language produced it.
 *
 * Both linters in this package do the same thing with a different analyzer behind them, and
 * the part that must not differ is this one: a brief's squiggle and a template's have to
 * land on their characters the same way, carry the code the same way and clamp the same
 * way. One implementation is how that stays true.
 *
 * Nothing is converted on the way in. A `SourceRange` is already the pair of UTF-16 offsets
 * CodeMirror consumes (`packages/core/src/source/range.ts`), so a marker cannot sit on
 * different characters than a `tyto render` error.
 */

/**
 * Where the marker goes.
 *
 * A diagnostic with no range is one nothing in the file caused — `E_NO_TEMPLATE` is the
 * case: the mistake is a line the author never wrote. It lands on the first line rather
 * than at offset zero, because a zero-width marker on an empty document is a squiggle
 * nobody can see or hover.
 */
export function spanOf(item: Diagnostic, view: EditorView): { from: number; to: number } {
  const length = view.state.doc.length;
  if (item.range === undefined) {
    const first = view.state.doc.line(1);
    return { from: first.from, to: first.to };
  }
  // Clamped because an analyzer answers about the text it was given, and the author may
  // have deleted past the end of it while the answer was in flight.
  const from = Math.min(item.range.start, length);
  return { from, to: Math.max(from, Math.min(item.range.end, length)) };
}

/**
 * The marker, with a one-word fix when the caller worked one out.
 *
 * `suggestion` is the caller's because the candidates are: a brief's unknown slot is
 * answered from a manifest, a template's unsupported property from a fixed vocabulary, and
 * neither list belongs here.
 */
export function toMarker(item: Diagnostic, view: EditorView, suggestion?: string): LintDiagnostic {
  const { from, to } = spanOf(item, view);

  return {
    from,
    to,
    severity: item.severity,
    // The code, not "tyto": it is what `docs/diagnostic-codes.md` is indexed by, so a
    // reader who hovers a marker has the string that finds the rule behind it.
    source: item.code,
    message: item.hint === undefined ? item.message : `${item.message} ${item.hint}`,
    ...(suggestion === undefined
      ? {}
      : {
          actions: [
            {
              name: `Replace with '${suggestion}'`,
              // The positions are the ones CodeMirror has mapped forward, not the ones the
              // diagnostic was built with — which is why the action takes them as
              // arguments and this closure does not capture `from`/`to`.
              apply: (target: EditorView, start: number, end: number) => {
                target.dispatch({ changes: { from: start, to: end, insert: suggestion } });
              },
            },
          ],
        }),
  };
}

/**
 * Views currently mounted, so an answer that arrives after `destroy()` is dropped.
 *
 * `EditorView.destroyed` is private, and the window is real: a lint source reads the
 * document, awaits an analyzer that may be a worker, and only then dispatches. A host that
 * swaps files by destroying the editor and building another — which is what the demo's
 * read-only toggle does — closes that window on every swap.
 */
const mounted = new WeakSet<EditorView>();

export const isMounted = (view: EditorView): boolean => mounted.has(view);

export const livenessPlugin: Extension = ViewPlugin.define((view: EditorView) => {
  mounted.add(view);
  return {
    destroy: () => {
      mounted.delete(view);
    },
  };
});
