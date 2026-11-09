import { isolateHistory } from '@codemirror/commands';
import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type Text,
  Transaction,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/**
 * An agent's proposed edit, shown in the document and applied only when the person accepts it
 * (TYTO-566, ADR 0180 decision 5).
 *
 * **One proposal per document.** It is a set of non-overlapping edits on the document as it is
 * when proposed. The text each replaces is struck through and what it inserts is drawn beside it;
 * a bar above the first edit offers Accept and Reject. No key is bound: Escape is vim's way out
 * of insert mode, and a proposal rejected by a person leaving insert mode is a proposal lost.
 *
 * **Accepted, it is one undo step**: the edits go in as one transaction with a history event of
 * its own, as Format Brief's do, so one Ctrl+Z gives back the text from before, never part of it,
 * and never merged with the typing next to it. Accepting writes no file: the document is unsaved
 * afterwards, as if the person had typed it.
 *
 * **While it waits, the person keeps typing.** An edit elsewhere moves the proposal with the text.
 * An edit that touches a proposed range makes it **stale**: it is removed, never re-aimed at text
 * the person rewrote. The host hears every outcome — accepted, rejected, stale — through
 * {@link proposalSettled}.
 */

/** One replacement, as offsets into the document it was proposed on. */
export interface ProposedEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface Proposal {
  /** The host's id for it, which the outcome is reported under. */
  readonly id: string;
  /** Sorted, non-overlapping, inside the document. */
  readonly edits: readonly ProposedEdit[];
}

export type ProposalOutcome = 'accepted' | 'rejected' | 'stale';

/** The words of the bar, handed in by the host so this package holds no language. */
export interface ProposalLabels {
  readonly title: string;
  readonly accept: string;
  readonly reject: string;
}

const DEFAULT_LABELS: ProposalLabels = {
  title: 'Proposed by an agent',
  accept: 'Accept',
  reject: 'Reject',
};

export const proposalLabels = Facet.define<ProposalLabels, ProposalLabels>({
  combine: (values) => values.at(-1) ?? DEFAULT_LABELS,
});

/** Called once per proposal, with how it ended. */
export const proposalSettled = Facet.define<(id: string, outcome: ProposalOutcome) => void>();

/** Shows a proposal; refused by {@link proposeInState} when one is already pending. */
export const proposeEffect = StateEffect.define<Proposal>();

const settleEffect = StateEffect.define<{ id: string; outcome: ProposalOutcome }>();

interface ProposalValue {
  readonly proposal: Proposal | undefined;
  /** How the last proposal ended, in the transaction that ended it. */
  readonly settled: { readonly id: string; readonly outcome: ProposalOutcome } | undefined;
}

const EMPTY: ProposalValue = { proposal: undefined, settled: undefined };

/** Whether these edits fit this document: sorted, apart, inside it. */
export function validEdits(doc: Text, edits: readonly ProposedEdit[]): boolean {
  if (edits.length === 0) return false;
  let end = 0;
  for (const edit of edits) {
    if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to)) return false;
    if (edit.from < end || edit.to < edit.from || edit.to > doc.length) return false;
    end = edit.to;
  }
  return true;
}

const proposalField = StateField.define<ProposalValue>({
  create: () => EMPTY,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(settleEffect) && value.proposal?.id === effect.value.id) {
        return { proposal: undefined, settled: effect.value };
      }
    }
    let next: ProposalValue =
      value.settled === undefined ? value : { ...value, settled: undefined };
    const proposal = next.proposal;
    if (proposal !== undefined && !transaction.changes.empty) {
      const changes = transaction.changes;
      if (proposal.edits.some((edit) => changes.touchesRange(edit.from, edit.to))) {
        return { proposal: undefined, settled: { id: proposal.id, outcome: 'stale' } };
      }
      next = {
        proposal: {
          id: proposal.id,
          edits: proposal.edits.map((edit) => ({
            from: changes.mapPos(edit.from, 1),
            to: changes.mapPos(edit.to, -1),
            insert: edit.insert,
          })),
        },
        settled: undefined,
      };
    }
    for (const effect of transaction.effects) {
      if (
        effect.is(proposeEffect) &&
        next.proposal === undefined &&
        validEdits(transaction.newDoc, effect.value.edits)
      ) {
        next = { proposal: effect.value, settled: undefined };
      }
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.compute([field, proposalLabels], (state) =>
      decorate(state, state.field(field).proposal),
    ),
});

/** The proposal pending in this document, with its edits where the text now puts them. */
export function pendingProposal(state: EditorState): Proposal | undefined {
  return state.field(proposalField, false)?.proposal;
}

/**
 * The effect that shows `proposal`, or why it cannot be shown: one is already pending, or the
 * edits do not fit the document. The caller dispatches it.
 */
export function proposeInState(
  state: EditorState,
  proposal: Proposal,
):
  | { readonly ok: true; readonly effect: StateEffect<Proposal> }
  | { readonly ok: false; readonly reason: 'pending' | 'invalid' } {
  if (pendingProposal(state) !== undefined) return { ok: false, reason: 'pending' };
  if (!validEdits(state.doc, proposal.edits)) return { ok: false, reason: 'invalid' };
  return { ok: true, effect: proposeEffect.of(proposal) };
}

/** Applies the pending proposal as one undo step. False when none is pending. */
export function acceptProposal(view: EditorView): boolean {
  const proposal = pendingProposal(view.state);
  if (proposal === undefined) return false;
  view.dispatch({
    changes: proposal.edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert })),
    effects: settleEffect.of({ id: proposal.id, outcome: 'accepted' }),
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('agent.accept')],
    scrollIntoView: true,
  });
  return true;
}

/** Drops the pending proposal; the text is untouched. False when none is pending. */
export function rejectProposal(view: EditorView): boolean {
  const proposal = pendingProposal(view.state);
  if (proposal === undefined) return false;
  view.dispatch({ effects: settleEffect.of({ id: proposal.id, outcome: 'rejected' }) });
  return true;
}

class InsertedWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: InsertedWidget): boolean {
    return other.text === this.text;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-proposal-inserted';
    element.textContent = this.text;
    return element;
  }
}

class BarWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly labels: ProposalLabels,
  ) {
    super();
  }

  override eq(other: BarWidget): boolean {
    return (
      other.id === this.id &&
      other.labels.title === this.labels.title &&
      other.labels.accept === this.labels.accept &&
      other.labels.reject === this.labels.reject
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'cm-proposal-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', this.labels.title);
    const title = document.createElement('span');
    title.className = 'cm-proposal-title';
    title.textContent = this.labels.title;
    bar.append(title);
    for (const [label, act, name] of [
      [this.labels.accept, acceptProposal, 'accept'],
      [this.labels.reject, rejectProposal, 'reject'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `cm-button cm-proposal-${name}`;
      button.textContent = label;
      // Keeps the caret where it was: a mousedown would move the editor's focus and selection.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        act(view);
        view.focus();
      });
      bar.append(button);
    }
    return bar;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function decorate(state: EditorState, proposal: Proposal | undefined): DecorationSet {
  if (proposal === undefined) return Decoration.none;
  const [first] = proposal.edits;
  if (first === undefined) return Decoration.none;
  const ranges = [
    Decoration.widget({
      widget: new BarWidget(proposal.id, state.facet(proposalLabels)),
      block: true,
      side: -1,
    }).range(state.doc.lineAt(first.from).from),
  ];
  for (const edit of proposal.edits) {
    if (edit.to > edit.from) {
      ranges.push(Decoration.mark({ class: 'cm-proposal-removed' }).range(edit.from, edit.to));
    }
    if (edit.insert !== '') {
      ranges.push(
        Decoration.widget({ widget: new InsertedWidget(edit.insert), side: 1 }).range(edit.to),
      );
    }
  }
  return Decoration.set(ranges, true);
}

const reportSettled = EditorView.updateListener.of((update) => {
  const settled = update.state.field(proposalField, false)?.settled;
  if (settled === undefined || settled === update.startState.field(proposalField, false)?.settled) {
    return;
  }
  for (const listener of update.state.facet(proposalSettled)) listener(settled.id, settled.outcome);
});

/** Mount once per document state; the host dispatches {@link proposeEffect} to propose. */
export function proposals(): Extension {
  // Painted by `theme.ts`, which alone reads the window's tokens.
  return [proposalField, reportSettled];
}
