import type { EditToPropose, ProposalStatus } from '@tyto/command-line';
import type { ProposedEdit } from '@tyto/editor';

/**
 * An agent's proposal, turned from lines and columns into offsets of the document in front, and
 * checked against what the agent expects there (TYTO-566, ADR 0180 decision 5). Pure, so the
 * three refusals are tested without a window: a position outside the text, edits that overlap,
 * and a range whose text is not what the agent read — stale before it was ever shown.
 */

/** The part of a CodeMirror `Text` this reads. */
export interface LinedText {
  readonly lines: number;
  line(number: number): { readonly from: number; readonly to: number };
  sliceString(from: number, to: number): string;
}

export type Offsets =
  | { readonly ok: true; readonly edits: readonly ProposedEdit[] }
  | { readonly ok: false; readonly reason: string };

function offsetOf(
  doc: LinedText,
  position: { readonly line: number; readonly column: number },
): number | undefined {
  if (position.line < 1 || position.line > doc.lines) return undefined;
  const line = doc.line(position.line);
  const offset = line.from + position.column - 1;
  return position.column >= 1 && offset <= line.to ? offset : undefined;
}

const where = (position: { readonly line: number; readonly column: number }): string =>
  `line ${String(position.line)}, column ${String(position.column)}`;

export function offsetsOf(doc: LinedText, edits: readonly EditToPropose[]): Offsets {
  const placed: ProposedEdit[] = [];
  for (const edit of edits) {
    const from = offsetOf(doc, edit.from);
    const to = offsetOf(doc, edit.to);
    if (from === undefined || to === undefined || to < from) {
      return {
        ok: false,
        reason: `the range from ${where(edit.from)} to ${where(edit.to)} is not in the document`,
      };
    }
    if (doc.sliceString(from, to) !== edit.expect) {
      return {
        ok: false,
        reason: `stale: the text at ${where(edit.from)} is not what was expected; read it again with brief_in_front`,
      };
    }
    placed.push({ from, to, insert: edit.insert });
  }
  placed.sort((left, right) => left.from - right.from);
  for (let index = 1; index < placed.length; index += 1) {
    if ((placed[index]?.from ?? 0) < (placed[index - 1]?.to ?? 0)) {
      return { ok: false, reason: 'two edits overlap; propose them as one' };
    }
  }
  return { ok: true, edits: placed };
}

/** How many settled proposals the window remembers for `proposal_status`. */
export const KEPT_PROPOSALS = 50;

/**
 * Where each proposal stands, by id, the newest {@link KEPT_PROPOSALS}. A proposal whose tab
 * went away before it was settled answers `gone`, which the caller decides from the documents.
 */
export class ProposalLedger {
  readonly #statuses = new Map<string, { status: ProposalStatus; documentId: string }>();
  #next = 1;

  /** A new id for a proposal about to be shown in `documentId`. */
  open(documentId: string): string {
    const id = `proposal-${String(this.#next)}`;
    this.#next += 1;
    this.#statuses.set(id, { status: 'proposed', documentId });
    while (this.#statuses.size > KEPT_PROPOSALS) {
      const oldest = this.#statuses.keys().next().value;
      if (oldest === undefined) break;
      this.#statuses.delete(oldest);
    }
    return id;
  }

  settle(id: string, status: ProposalStatus): void {
    const entry = this.#statuses.get(id);
    if (entry !== undefined && entry.status === 'proposed') entry.status = status;
  }

  /** The status, `gone` for a pending one whose document is no longer open. */
  status(id: string, isOpen: (documentId: string) => boolean): ProposalStatus | undefined {
    const entry = this.#statuses.get(id);
    if (entry === undefined) return undefined;
    if (entry.status === 'proposed' && !isOpen(entry.documentId)) entry.status = 'gone';
    return entry.status;
  }
}
