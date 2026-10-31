// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { OutputLink } from './command-links.js';
import { type CommandPanel, type CommandPanelPorts, COMMAND_PANEL_TAG } from './command-panel.js';
import { type CommandSession, CommandSessions } from './command-sessions.js';

/**
 * The command panel (TYTO-496) as jsdom can see it: the input line, the history keys, the
 * tabs and their status, Stop, the links in the output, find and copy. Where it sits beside
 * Problems, and what a real run prints, are the e2e's and the real window's.
 */

// jsdom lays nothing out, so it has no `scrollIntoView`; stepping through matches calls it.
Element.prototype.scrollIntoView = () => undefined;

interface Harness {
  readonly element: CommandPanel;
  readonly sessions: CommandSessions;
  readonly ran: (readonly string[])[];
  readonly cancelled: string[];
  readonly opened: OutputLink[];
  readonly copied: string[];
  readonly history: string[];
}

async function mount(
  options: { history?: string[]; locale?: 'en' | 'pt-BR'; folder?: string | null } = {},
): Promise<Harness> {
  document.body.innerHTML = `<${COMMAND_PANEL_TAG}></${COMMAND_PANEL_TAG}>`;
  const element = document.querySelector<CommandPanel>(COMMAND_PANEL_TAG)!;
  const sessions = new CommandSessions();
  const harness: Harness = {
    element,
    sessions,
    ran: [],
    cancelled: [],
    opened: [],
    copied: [],
    history: options.history ?? [],
  };
  let runs = 0;
  const ports: CommandPanelPorts = {
    run: (words) => {
      harness.ran.push(words);
      runs += 1;
      return Promise.resolve(`run-${String(runs)}`);
    },
    cancel: (runId) => harness.cancelled.push(runId),
    open: (_session: CommandSession, link) => harness.opened.push(link),
    folder: () => options.folder ?? null,
    caseless: true,
    history: () => harness.history,
    remember: (line) => harness.history.push(line),
    copy: (text) => harness.copied.push(text),
  };
  element.locale = options.locale ?? 'en';
  element.sessions = sessions;
  element.ports = ports;
  await element.updateComplete;
  return harness;
}

const input = (element: HTMLElement) =>
  element.querySelector<HTMLInputElement>('.command-panel__input')!;

async function press(
  element: CommandPanel,
  target: HTMLElement,
  key: string,
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {},
): Promise<void> {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  await element.updateComplete;
  // `submit` awaits the run's id before binding it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
}

async function typeAndRun(harness: Harness, line: string): Promise<void> {
  input(harness.element).value = line;
  await press(harness.element, input(harness.element), 'Enter');
}

const lines = (element: HTMLElement) =>
  [...element.querySelectorAll('.command-panel__line')].map((line) => line.textContent);

const tabs = (element: HTMLElement) => [...element.querySelectorAll('[role="tab"]')];

describe('running a line', () => {
  it('runs the words, echoes the line, remembers it and clears the input', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'tyto render "Meus briefs/a.brief" --types svg');
    expect(harness.ran).toEqual([['render', 'Meus briefs/a.brief', '--types', 'svg']]);
    expect(harness.history).toEqual(['tyto render "Meus briefs/a.brief" --types svg']);
    expect(lines(harness.element)).toEqual(['$ tyto render "Meus briefs/a.brief" --types svg']);
    expect(input(harness.element).value).toBe('');
    expect(harness.sessions.active.runId).toBe('run-1');
    expect(tabs(harness.element)[0]?.textContent).toContain('render "Meus briefs/a.brief"');
  });

  it('refuses a line with an unclosed quote, saying where, and runs nothing', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'render "Meus briefs/a.brief');
    expect(harness.ran).toEqual([]);
    expect(harness.history).toEqual([]);
    expect(lines(harness.element)).toEqual([
      'A quote opened at column 8 is not closed. Nothing was run.',
    ]);
  });

  it('runs nothing while the tab’s command is still running', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'watch .');
    await typeAndRun(harness, 'check a.brief');
    expect(harness.ran).toEqual([['watch', '.']]);
    expect(lines(harness.element).at(-1)).toContain('A command is running in this session');
  });

  it('says why when cli:run refused the words', async () => {
    const harness = await mount();
    harness.element.ports = {
      ...harness.element.ports,
      run: () => Promise.reject(new Error('too many words')),
    };
    await typeAndRun(harness, 'render a');
    expect(lines(harness.element).at(-1)).toBe('The command was not run: too many words');
    expect(harness.sessions.active.state).toBe('idle');
  });
});

describe('the history keys', () => {
  it('walks back with ↑ and forward to what was typed with ↓', async () => {
    const harness = await mount({ history: ['render a.brief', 'check b.brief'] });
    const field = input(harness.element);
    field.value = 'half';
    await press(harness.element, field, 'ArrowUp');
    expect(field.value).toBe('check b.brief');
    await press(harness.element, field, 'ArrowUp');
    expect(field.value).toBe('render a.brief');
    await press(harness.element, field, 'ArrowDown');
    await press(harness.element, field, 'ArrowDown');
    expect(field.value).toBe('half');
  });

  it('searches with Ctrl+R, steps older with Ctrl+R again, and runs the match on Enter', async () => {
    const harness = await mount({
      history: ['render old.brief', 'check b.brief', 'render new.brief'],
    });
    const field = input(harness.element);
    await press(harness.element, field, 'r', { ctrlKey: true });
    expect(harness.element.querySelector('.command-panel__prompt')?.textContent?.trim()).toBe(
      'history',
    );
    field.value = 'render';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await harness.element.updateComplete;
    const match = () =>
      harness.element.querySelector('.command-panel__search-match')?.textContent?.trim();
    expect(match()).toBe('render new.brief');
    await press(harness.element, field, 'r', { ctrlKey: true });
    expect(match()).toBe('render old.brief');
    await press(harness.element, field, 'Enter');
    expect(harness.ran).toEqual([['render', 'old.brief']]);
  });

  it('gives the line back on Escape', async () => {
    const harness = await mount({ history: ['render a.brief'] });
    const field = input(harness.element);
    await press(harness.element, field, 'r', { ctrlKey: true });
    await press(harness.element, field, 'Escape');
    expect(harness.element.querySelector('.command-panel__prompt')?.textContent?.trim()).toBe(
      'tyto',
    );
    expect(harness.ran).toEqual([]);
  });
});

describe('the sessions', () => {
  it('opens a new tab in front, and moves between tabs with the arrows', async () => {
    const harness = await mount();
    harness.element
      .querySelector<HTMLButtonElement>('[data-action="commandPanel.session.new"]')!
      .click();
    await harness.element.updateComplete;
    expect(tabs(harness.element).map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
    await press(harness.element, tabs(harness.element)[1] as HTMLElement, 'ArrowLeft');
    expect(tabs(harness.element).map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
    ]);
    expect(tabs(harness.element)[0]?.textContent?.trim()).toBe('Session 1');
  });

  it('shows how a run ended on its tab, in words for a screen reader', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    harness.sessions.state({ runId: 'run-1', state: 'finished', code: 1 });
    await harness.element.updateComplete;
    const status = harness.element.querySelector('.command-session__status');
    expect(status?.textContent?.trim()).toBe('1');
    expect(status?.getAttribute('data-state')).toBe('failed');
    expect(tabs(harness.element)[0]?.getAttribute('aria-label')).toBe(
      'check a.brief, ended with exit code 1',
    );
  });

  it('stops the run in front, and only while there is one', async () => {
    const harness = await mount();
    const stop = () =>
      harness.element.querySelector<HTMLButtonElement>('[data-action="commandPanel.stop"]')!;
    expect(stop().disabled).toBe(true);
    await typeAndRun(harness, 'watch .');
    expect(stop().disabled).toBe(false);
    stop().click();
    expect(harness.cancelled).toEqual(['run-1']);
  });

  it('stops a tab’s run when the tab is closed', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'watch .');
    harness.element.querySelector<HTMLButtonElement>('.command-session__close')!.click();
    expect(harness.cancelled).toEqual(['run-1']);
  });
});

describe('the output', () => {
  it('draws colours and makes a diagnostic’s place a link that opens its row', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    const row = {
      index: 0,
      severity: 'error' as const,
      code: 'E_X',
      message: 'bad',
      where: 'C:\\w\\a.brief',
      line: 2,
      column: 1,
      openable: true,
    };
    harness.sessions.diagnostics({ runId: 'run-1', label: 'check a.brief', diagnostics: [row] });
    harness.sessions.output({
      runId: 'run-1',
      stream: 'err',
      text: '\u001b[31merror\u001b[0m E_X C:\\w\\a.brief:2:1 bad\n',
    });
    await harness.element.updateComplete;
    expect(harness.element.querySelector('.ansi-fg-1')?.textContent).toBe('error');
    const link = harness.element.querySelector<HTMLAnchorElement>('.command-panel__link')!;
    expect(link.textContent).toBe('C:\\w\\a.brief:2:1');
    link.click();
    expect(harness.opened).toEqual([{ kind: 'diagnostic', row }]);
  });

  it('finds with Ctrl+F and counts the matches', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    harness.sessions.output({ runId: 'run-1', stream: 'out', text: 'one warning\ntwo warning\n' });
    await harness.element.updateComplete;
    await press(harness.element, input(harness.element), 'f', { ctrlKey: true });
    const find = harness.element.querySelector<HTMLInputElement>('.command-panel__find-input')!;
    find.value = 'WARNING';
    find.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await harness.element.updateComplete;
    const count = () =>
      harness.element.querySelector('.command-panel__find-count')?.textContent?.trim();
    expect(count()).toBe('1 of 2');
    expect(harness.element.querySelectorAll('.command-panel__match')).toHaveLength(2);
    await press(harness.element, find, 'Enter');
    expect(count()).toBe('2 of 2');
  });

  it('copies the whole output as text, and clears it', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    harness.sessions.output({ runId: 'run-1', stream: 'out', text: '\u001b[32mok\u001b[0m\n' });
    await harness.element.updateComplete;
    harness.element.querySelector<HTMLButtonElement>('[data-action="commandPanel.copy"]')!.click();
    expect(harness.copied).toEqual(['$ tyto check a.brief\nok']);
    harness.element.querySelector<HTMLButtonElement>('[data-action="commandPanel.clear"]')!.click();
    await harness.element.updateComplete;
    expect(lines(harness.element)).toEqual([]);
  });

  it('keeps drawing a tab’s output when the element is made again', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'watch .');
    harness.sessions.output({ runId: 'run-1', stream: 'out', text: 'swept 3\n' });
    // The dock removes the element when the panel closes and makes a new one when it opens.
    document.body.innerHTML = `<${COMMAND_PANEL_TAG}></${COMMAND_PANEL_TAG}>`;
    const again = document.querySelector<CommandPanel>(COMMAND_PANEL_TAG)!;
    again.sessions = harness.sessions;
    await again.updateComplete;
    harness.sessions.output({ runId: 'run-1', stream: 'out', text: 'swept 4\n' });
    await again.updateComplete;
    expect(lines(again)).toEqual(['$ tyto watch .', 'swept 3', 'swept 4']);
  });
});

describe('its words', () => {
  it('names itself and its input in Portuguese', async () => {
    const harness = await mount({ locale: 'pt-BR' });
    expect(harness.element.querySelector('.tool__title')?.textContent).toBe('Comandos');
    expect(input(harness.element).getAttribute('aria-label')).toBe(
      'Digite um comando do tyto e tecle Enter',
    );
  });
});
