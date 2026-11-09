import { describe, expect, it } from 'vitest';

import type { AgentWindowActions } from '../../shared/settings.js';
import {
  type AgentAction,
  type AgentQuestion,
  DECLINED,
  NOT_ANSWERED,
  PENDING,
  type WindowState,
  createAgentWindow,
} from './agent-window.js';

/**
 * The window's side of the agent's window tools (ADR 0180 decision 6), with a fake renderer that
 * answers every ask and a fake person who answers every box.
 */

const front: WindowState = {
  documentId: 'doc-1',
  name: 'a.brief',
  kind: 'brief',
  text: 'typed, unsaved',
  unsaved: true,
  format: 'feed',
  ranges: [{ from: { line: 1, column: 1 }, to: { line: 1, column: 6 }, text: 'typed' }],
};

function harness(
  options: {
    setting?: AgentWindowActions;
    person?: (question: AgentQuestion) => Promise<boolean>;
    renderer?: 'answers' | 'silent';
  } = {},
) {
  const questions: AgentQuestion[] = [];
  const actions: AgentAction[] = [];
  const openedPaths: (string | undefined)[] = [];
  const agent = createAgentWindow({
    sendState: (askId) => {
      if (options.renderer === 'silent') return;
      queueMicrotask(() => agent.reply(askId, { state: front }));
    },
    sendAct: (askId, action) => {
      actions.push(action);
      openedPaths.push(agent.pathFor(askId));
      queueMicrotask(() => agent.reply(askId, { acted: { done: true } }));
    },
    pathOf: (documentId) => (documentId === 'doc-1' ? '/work/a.brief' : undefined),
    windowActions: () => options.setting ?? 'propose',
    ask: (question) => {
      questions.push(question);
      return options.person?.(question) ?? Promise.resolve(true);
    },
    timeoutMs: 50,
  });
  return { port: agent.port, questions, actions, openedPaths };
}

describe('the agent window port', () => {
  it('answers the brief in front with the path main filed it under, and its selection', async () => {
    const { port } = harness();
    expect(await port.briefInFront()).toEqual({
      path: '/work/a.brief',
      name: 'a.brief',
      text: 'typed, unsaved',
      unsaved: true,
      kind: 'brief',
      format: 'feed',
    });
    expect((await port.selection())?.ranges.map((range) => range.text)).toEqual(['typed']);
  });

  it('asks the person first under propose, naming the full path, and opens on yes', async () => {
    const { port, questions, actions, openedPaths } = harness();
    expect(await port.openFile('/work/b.brief')).toEqual({ done: true });
    expect(questions).toEqual([{ kind: 'open', path: '/work/b.brief' }]);
    expect(actions).toEqual([{ kind: 'open' }]);
    expect(openedPaths).toEqual(['/work/b.brief']);
  });

  it('names the format and the brief when asking to show one', async () => {
    const { port, questions } = harness();
    expect(await port.showFormat('story')).toEqual({ done: true });
    expect(questions).toEqual([{ kind: 'show', format: 'story', brief: '/work/a.brief' }]);
  });

  it('does nothing when the person says no', async () => {
    const { port, actions } = harness({ person: () => Promise.resolve(false) });
    expect(await port.openFile('/work/b.brief')).toEqual({ done: false, reason: DECLINED });
    expect(actions).toEqual([]);
  });

  it('acts without a box under allow', async () => {
    const { port, questions, actions } = harness({ setting: 'allow' });
    expect(await port.showFormat('story')).toEqual({ done: true });
    expect(questions).toEqual([]);
    expect(actions).toEqual([{ kind: 'show', format: 'story' }]);
  });

  it('declines a second request while a box is up, with no second box', async () => {
    let answer: (yes: boolean) => void = () => {};
    let boxes = 0;
    const { port, questions, actions } = harness({
      // The first box stays up until the test answers it; any later one says yes at once.
      person: () => {
        boxes += 1;
        if (boxes > 1) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          answer = resolve;
        });
      },
    });
    const first = port.openFile('/work/b.brief');
    await Promise.resolve();
    expect(await port.openFile('/work/c.brief')).toEqual({ done: false, reason: PENDING });
    expect(await port.showFormat('story')).toEqual({ done: false, reason: PENDING });
    expect(questions).toHaveLength(1);

    answer(true);
    expect(await first).toEqual({ done: true });
    expect(actions).toEqual([{ kind: 'open' }]);
    // The box is down: the next request gets its own.
    expect(await port.openFile('/work/c.brief')).toEqual({ done: true });
    expect(questions).toHaveLength(2);
  });

  it('says the window did not answer when the renderer is silent', async () => {
    const { port } = harness({ renderer: 'silent' });
    expect(await port.briefInFront()).toBeUndefined();
    expect(NOT_ANSWERED).toMatch(/did not answer/u);
  });
});
