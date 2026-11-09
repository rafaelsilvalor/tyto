import type {
  BriefInFront,
  EditToPropose,
  ProposalAnswer,
  ProposalStatus,
  SelectedRange,
  WindowActionAnswer,
  WindowPort,
} from '@tyto/command-line';

import type { AgentWindowActions } from '../../shared/settings.js';

/**
 * The window's side of an agent's window tools (TYTO-566, ADR 0180): a {@link WindowPort} that
 * asks the renderer what is in front and tells it what to do, by an id per ask — the request/reply
 * of `app:exit-requested` and `app:exit-answer` (ADR 0029), turned toward agents.
 *
 * A window action is asked of the person first when `agentsWindowActions` is `propose`, the
 * default (decision 6). **One question at a time**: a second action while a box is up is declined
 * at once, with no second box, so an agent cannot stack dialogs in front of the person.
 */

/** How long the renderer has to answer an ask before the tool says the window did not. */
export const AGENT_ASK_TIMEOUT_MS = 10_000;

export const NOT_ANSWERED = 'the window did not answer in time';
export const DECLINED = 'declined: the person chose not to';
export const PENDING = 'declined: another request is pending';

/** What the renderer answers an `agent:state` ask, before main resolves its path. */
export interface WindowState {
  readonly documentId: string;
  readonly name: string | null;
  readonly kind: string;
  readonly text: string;
  readonly unsaved: boolean;
  readonly format: string | null;
  readonly ranges: readonly SelectedRange[] | null;
}

export type AgentReply =
  | { readonly state: WindowState | null }
  | { readonly acted: WindowActionAnswer }
  | { readonly proposal: ProposalAnswer }
  | { readonly status: ProposalStatus | null };

export type AgentAction =
  | { readonly kind: 'open' }
  | { readonly kind: 'show'; readonly format: string }
  | { readonly kind: 'propose'; readonly edits: readonly EditToPropose[] }
  | { readonly kind: 'status'; readonly id: string };

/** A question for the person, one at a time; true when they said yes. */
export type AskPerson = (question: AgentQuestion) => Promise<boolean>;

export type AgentQuestion =
  | { readonly kind: 'open'; readonly path: string }
  | {
      readonly kind: 'show';
      readonly format: string;
      /** The brief in front: its full path, its tab's name when it is in no file, or none. */
      readonly brief: string | null;
    };

export interface AgentWindowOptions {
  readonly sendState: (askId: number) => void;
  readonly sendAct: (askId: number, action: AgentAction) => void;
  /** Where main filed a document's path, by the window's id for it. */
  readonly pathOf: (documentId: string) => string | undefined;
  readonly windowActions: () => AgentWindowActions;
  readonly ask: AskPerson;
  readonly timeoutMs?: number;
}

export interface AgentWindow {
  readonly port: WindowPort;
  /** The renderer's answer, from `agent:reply`; a late or unknown id is dropped. */
  reply(askId: number, answer: AgentReply): void;
  /** The path an `open` ask names, for `agent:open`; undefined once answered or unknown. */
  pathFor(askId: number): string | undefined;
}

export function createAgentWindow(options: AgentWindowOptions): AgentWindow {
  const timeoutMs = options.timeoutMs ?? AGENT_ASK_TIMEOUT_MS;
  const waiting = new Map<number, (answer: AgentReply | undefined) => void>();
  const opening = new Map<number, string>();
  let nextAsk = 1;
  let asking = false;

  const ask = (send: (askId: number) => void): Promise<AgentReply | undefined> => {
    const askId = nextAsk++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(askId);
        resolve(undefined);
      }, timeoutMs);
      waiting.set(askId, (answer) => {
        clearTimeout(timer);
        waiting.delete(askId);
        resolve(answer);
      });
      send(askId);
    });
  };

  const state = async (): Promise<WindowState | null | undefined> => {
    const answer = await ask(options.sendState);
    if (answer === undefined || !('state' in answer)) return undefined;
    return answer.state;
  };

  const acted = (answer: AgentReply | undefined): WindowActionAnswer =>
    answer !== undefined && 'acted' in answer
      ? answer.acted
      : { done: false, reason: NOT_ANSWERED };

  /** Asks the person when the setting says so, one box at a time; true when it may go ahead. */
  const allowed = async (question: AgentQuestion): Promise<WindowActionAnswer | true> => {
    if (options.windowActions() === 'allow') return true;
    if (asking) return { done: false, reason: PENDING };
    asking = true;
    try {
      return (await options.ask(question)) ? true : { done: false, reason: DECLINED };
    } finally {
      asking = false;
    }
  };

  const port: WindowPort = {
    async briefInFront(): Promise<BriefInFront | undefined> {
      const front = await state();
      if (front === null || front === undefined) return undefined;
      return {
        path: options.pathOf(front.documentId) ?? null,
        name: front.name,
        text: front.text,
        unsaved: front.unsaved,
        kind: front.kind,
        format: front.format,
      };
    },
    async selection() {
      const front = await state();
      if (front === null || front === undefined || front.ranges === null) return undefined;
      return { ranges: front.ranges };
    },
    async openFile(path) {
      const go = await allowed({ kind: 'open', path });
      if (go !== true) return go;
      let opened: number | undefined;
      const answer = await ask((askId) => {
        opened = askId;
        opening.set(askId, path);
        options.sendAct(askId, { kind: 'open' });
      });
      if (opened !== undefined) opening.delete(opened);
      return acted(answer);
    },
    async showFormat(format) {
      // The box names the brief by its full path when it has one, else by its tab's name.
      const front = await state();
      const brief =
        front === null || front === undefined
          ? null
          : (options.pathOf(front.documentId) ?? front.name);
      const go = await allowed({ kind: 'show', format, brief });
      if (go !== true) return go;
      return acted(await ask((askId) => options.sendAct(askId, { kind: 'show', format })));
    },
    // A text edit is always a proposal (ADR 0180 decision 5): no box and no setting, the
    // editor itself asks, and the agent hears at once that it was shown.
    async proposeEdit(edits) {
      const answer = await ask((askId) => options.sendAct(askId, { kind: 'propose', edits }));
      return answer !== undefined && 'proposal' in answer
        ? answer.proposal
        : { proposed: false, reason: NOT_ANSWERED };
    },
    async proposalStatus(id) {
      const answer = await ask((askId) => options.sendAct(askId, { kind: 'status', id }));
      return answer !== undefined && 'status' in answer ? (answer.status ?? undefined) : undefined;
    },
  };

  return {
    port,
    reply(askId, answer) {
      waiting.get(askId)?.(answer);
    },
    pathFor: (askId) => opening.get(askId),
  };
}
