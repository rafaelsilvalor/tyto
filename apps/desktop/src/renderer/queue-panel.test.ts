// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import {
  type QueueActions,
  type QueuePanel,
  type QueueView,
  QUEUE_PANEL_TAG,
} from './queue-panel.js';

/**
 * The queue panel's states as jsdom can see them: which rows, which words, which buttons, and
 * what each button asks for. Whether the column is legible in a real window is
 * `e2e/queue.desktop.test.ts`'s question — jsdom does no layout.
 */

const VIEW: QueueView = {
  folder: '/fila',
  inbox: '/fila/inbox',
  autoRun: true,
  tasks: [
    { id: 'nova', status: 'pending', diagnostics: [], hasOutput: false },
    { id: 'andando', status: 'rendering', diagnostics: [], hasOutput: false },
    {
      id: 'quebrada',
      status: 'error',
      diagnostics: [
        {
          severity: 'error',
          code: 'E_UNKNOWN_TEMPLATE',
          message: "template 'nenhum' is not installed",
        },
      ],
      failure: 'rendered, but could not be moved to done/: EPERM',
      hasOutput: true,
    },
    { id: 'pronta', status: 'done', diagnostics: [], hasOutput: true },
  ],
};

function spies() {
  return {
    chooseFolder: vi.fn<() => void>(),
    clearFolder: vi.fn<() => void>(),
    setAutoRun: vi.fn<(on: boolean) => void>(),
    run: vi.fn<(taskId: string) => void>(),
    openBrief: vi.fn<(taskId: string) => void>(),
    openOutput: vi.fn<(taskId: string) => void>(),
  } satisfies QueueActions;
}

async function panel(
  view: QueuePanel['view'] = VIEW,
  actions: QueueActions = spies(),
): Promise<QueuePanel> {
  const element = document.createElement(QUEUE_PANEL_TAG);
  document.body.append(element);
  element.locale = 'en';
  element.view = view;
  element.actions = actions;
  await element.updateComplete;
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

const row = (element: QueuePanel, id: string): HTMLElement | null =>
  element.querySelector<HTMLElement>(`[data-task="${id}"]`);

const buttonsOf = (element: HTMLElement | null): string[] =>
  [...(element?.querySelectorAll('.queue__actions button') ?? [])].map(
    (button) => button.textContent?.trim() ?? '',
  );

describe('the queue panel', () => {
  it('lists every task with its status in words', async () => {
    const element = await panel();

    const rows = [...element.querySelectorAll<HTMLElement>('.queue__task')].map((item) => [
      item.dataset['task'],
      item.querySelector('.queue__status')?.textContent,
    ]);
    expect(rows).toEqual([
      ['nova', 'pending'],
      ['andando', 'rendering'],
      ['quebrada', 'error'],
      ['pronta', 'done'],
    ]);
    expect(element.querySelector('.queue__path')?.textContent).toBe('/fila/inbox');
  });

  it('offers Run on a pending task and Try again on a failed one, and neither otherwise', async () => {
    const element = await panel();

    expect(buttonsOf(row(element, 'nova'))).toEqual([
      translate('en', 'queue.run'),
      translate('en', 'queue.openBrief'),
    ]);
    expect(buttonsOf(row(element, 'quebrada'))).toEqual([
      translate('en', 'queue.retry'),
      translate('en', 'queue.openBrief'),
      translate('en', 'queue.openOutput'),
    ]);
    // Rendering: nothing to press. Done: only the output, because the brief has moved on.
    expect(buttonsOf(row(element, 'andando'))).toEqual([]);
    expect(buttonsOf(row(element, 'pronta'))).toEqual([translate('en', 'queue.openOutput')]);
  });

  it('shows a failed task its diagnostics and its failure', async () => {
    const element = await panel();
    const failed = row(element, 'quebrada');

    expect(failed?.querySelector('.queue__code')?.textContent).toBe('E_UNKNOWN_TEMPLATE');
    expect(failed?.querySelector('.queue__message')?.textContent).toBe(
      "template 'nenhum' is not installed",
    );
    expect(failed?.querySelector('.queue__failure')?.textContent).toMatch(/EPERM$/u);
  });

  it('names the task each button is about', async () => {
    const actions = spies();
    const element = await panel(VIEW, actions);

    row(element, 'quebrada')?.querySelector<HTMLButtonElement>('.queue__run')?.click();
    row(element, 'quebrada')?.querySelector<HTMLButtonElement>('.queue__open-brief')?.click();
    row(element, 'pronta')?.querySelector<HTMLButtonElement>('.queue__open-output')?.click();

    expect(actions.run).toHaveBeenCalledWith('quebrada');
    expect(actions.openBrief).toHaveBeenCalledWith('quebrada');
    expect(actions.openOutput).toHaveBeenCalledWith('pronta');
  });

  it('turns auto-run off from the checkbox', async () => {
    const actions = spies();
    const element = await panel(VIEW, actions);
    const box = element.querySelector<HTMLInputElement>('.queue__auto-run');

    expect(box?.checked).toBe(true);
    box?.click();

    expect(actions.setAutoRun).toHaveBeenCalledWith(false);
  });

  it('asks for a folder when there is none, and offers nothing else', async () => {
    const actions = spies();
    const element = await panel({ folder: null, inbox: null, autoRun: false, tasks: [] }, actions);

    expect(element.querySelector('.queue__note')?.textContent).toBe(
      translate('en', 'queue.folder.none'),
    );
    expect(element.querySelector('.queue__auto-run')).toBeNull();
    element.querySelector<HTMLButtonElement>('.queue__choose')?.click();
    expect(actions.chooseFolder).toHaveBeenCalledTimes(1);
  });

  it('says the queue is empty rather than drawing an empty list', async () => {
    const element = await panel({ ...VIEW, tasks: [] });

    expect(element.querySelector('.queue__empty')?.textContent).toBe(
      translate('en', 'queue.empty'),
    );
    expect(element.querySelector('.queue__tasks')).toBeNull();
  });

  it('says so when the queue could not be read', async () => {
    const element = await panel('failed');

    expect(element.querySelector('.queue__note--bad')?.textContent).toBe(
      translate('en', 'queue.unavailable'),
    );
  });

  it('is in Portuguese when the window is', async () => {
    const element = await panel();
    element.locale = 'pt-BR';
    await element.updateComplete;

    expect(row(element, 'quebrada')?.querySelector('.queue__status')?.textContent).toBe('erro');
    expect(buttonsOf(row(element, 'quebrada'))[0]).toBe('Tentar de novo');
  });
});
