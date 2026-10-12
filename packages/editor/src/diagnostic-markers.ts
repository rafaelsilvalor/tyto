import { type Diagnostic as LintDiagnostic, setDiagnostics } from '@codemirror/lint';
import {
  type EditorState,
  type Extension,
  type TransactionSpec,
  Transaction,
} from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';

/**
 * What a marker is built from: a Tyto `Diagnostic`, or anything shaped like one.
 *
 * Wider than `Diagnostic` on purpose (TYTO-256). A host's diagnostics cross a process boundary
 * as plain data — the desktop's settings checks come back from main with `code: string` and an
 * `info` severity the compiler never raises — and a marker needs only these five fields.
 */
export interface MarkedDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly range?: { readonly start: number; readonly end: number } | undefined;
  readonly hint?: string | undefined;
}

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
export function spanOf(item: MarkedDiagnostic, state: EditorState): { from: number; to: number } {
  const length = state.doc.length;
  if (item.range === undefined) {
    const first = state.doc.line(1);
    return { from: first.from, to: first.to };
  }
  // Clamped because an analyzer answers about the text it was given, and the author may
  // have deleted past the end of it while the answer was in flight.
  const from = Math.min(item.range.start, length);
  return { from, to: Math.max(from, Math.min(item.range.end, length)) };
}

/**
 * One word to write, and where inside the marker to write it.
 *
 * `within` exists because a diagnostic's range is not always exactly the thing that is
 * wrong. `E_BAD_ADJUSTMENT` on `{tom: claro}` is ranged over `tom: claro`, and the fix has
 * to replace `tom` and leave the value alone — without this it would either rewrite the
 * whole thing or not be offered at all (TYTO-92).
 */
export interface MarkerFix {
  readonly text: string;
  /** Offsets from the marker's start. The whole marker when omitted. */
  readonly within?: { readonly from: number; readonly to: number };
}

/**
 * The marker, with a one-word fix when the caller worked one out.
 *
 * The fix is the caller's because the candidates are: a brief's unknown slot is answered
 * from a manifest, a template's unsupported property from a fixed vocabulary, and neither
 * list belongs here.
 */
export function toMarker(
  item: MarkedDiagnostic,
  state: EditorState,
  fix?: MarkerFix,
): LintDiagnostic {
  const { from, to } = spanOf(item, state);

  return {
    from,
    to,
    severity: item.severity,
    // The code, not "tyto": it is what `docs/diagnostic-codes.md` is indexed by, so a
    // reader who hovers a marker has the string that finds the rule behind it.
    source: item.code,
    message: item.hint === undefined ? item.message : `${item.message} ${item.hint}`,
    ...(fix === undefined
      ? {}
      : {
          actions: [
            {
              name: `Replace with '${fix.text}'`,
              // `start` and `end` are the positions CodeMirror has mapped forward, not the
              // ones the diagnostic was built with — which is why the action takes them as
              // arguments rather than capturing `from`/`to`. `within` is measured from the
              // marker's start, so it rides along with the mapping for free.
              apply: (target: EditorView, start: number, end: number) => {
                const changes =
                  fix.within === undefined
                    ? { from: start, to: end, insert: fix.text }
                    : {
                        from: start + fix.within.from,
                        to: start + fix.within.to,
                        insert: fix.text,
                      };
                target.dispatch({ changes });
              },
            },
          ],
        }),
  };
}

/**
 * A transaction that puts these diagnostics on the document as its markers, replacing any it had.
 *
 * Pushed rather than pulled: a buffer with no linter of its own — the desktop's `settings.json`
 * tab, whose checks run in another process (TYTO-256) — is told its markers when the answer
 * arrives. `setDiagnostics` turns the lint extension on in a state that lacked it, and from then
 * on the markers map through every edit like a linter's do.
 *
 * Effect only, and kept off the undo history: Ctrl+Z must not take a squiggle back.
 */
export function diagnosticsSpec(
  state: EditorState,
  diagnostics: readonly MarkedDiagnostic[],
): TransactionSpec {
  return {
    ...setDiagnostics(
      state,
      diagnostics.map((item) => toMarker(item, state)),
    ),
    annotations: Transaction.addToHistory.of(false),
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
