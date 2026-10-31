// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { OutputLink } from './command-links.js';
import { type CommandPanel, type CommandPanelPorts, COMMAND_PANEL_TAG } from './command-panel.js';
import { type CommandSession, CommandSessions } from './command-sessions.js';

/**
 * The command panel (TYTO-496) as jsdom can see it: the input line, the history keys, the
 * tabs and their status, Stop, the links in the output, find and clear. Where it sits beside
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
  readonly history: string[];
}

async function mount(
  options: {
    history?: string[];
    locale?: 'en' | 'pt-BR';
    folder?: string | null;
    complete?: CommandPanelPorts['complete'];
  } = {},
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
    complete:
      options.complete ??
      ((_line, caret) => Promise.resolve({ from: caret, to: caret, items: [] })),
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

const headers = (element: HTMLElement) =>
  [...element.querySelectorAll('.command-run__command')].map((header) => header.textContent);

describe('running a line', () => {
  it('runs the words, echoes the line, remembers it and clears the input', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'tyto render "Meus briefs/a.brief" --types svg');
    expect(harness.ran).toEqual([['render', 'Meus briefs/a.brief', '--types', 'svg']]);
    expect(harness.history).toEqual(['tyto render "Meus briefs/a.brief" --types svg']);
    // No echo: the run's header says it, its paths cut to file names (TYTO-496).
    expect(lines(harness.element)).toEqual([]);
    expect(headers(harness.element)).toEqual(['render a.brief --types svg']);
    expect(input(harness.element).value).toBe('');
    expect(harness.sessions.active.runId).toBe('run-1');
    expect(harness.sessions.active.line).toBe('tyto render "Meus briefs/a.brief" --types svg');
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
      'history ›',
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
      'tyto ›',
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

  it('draws no session tabs while there is one session (ADR 0163)', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    expect(tabs(harness.element)).toEqual([]);
  });

  it('shows how a run ended on its tab, in words for a screen reader', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    harness.sessions.create();
    harness.sessions.select(harness.sessions.sessions[0]!.id);
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
      harness.element.querySelector<HTMLButtonElement>('[data-action="commandPanel.stop"]');
    expect(stop()).toBeNull();
    await typeAndRun(harness, 'watch .');
    stop()!.click();
    expect(harness.cancelled).toEqual(['run-1']);
  });

  it('stops a tab’s run when the tab is closed', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'watch .');
    harness.sessions.create();
    harness.sessions.select(harness.sessions.sessions[0]!.id);
    await harness.element.updateComplete;
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

  it('clears the output', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    harness.sessions.output({ runId: 'run-1', stream: 'out', text: 'ok\n' });
    await harness.element.updateComplete;
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
    expect(lines(again)).toEqual(['swept 3', 'swept 4']);
  });
});

describe('the prompt (ADR 0163)', () => {
  it('is the last line of the output, labelled, and the only stop in the tab order', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    const output = harness.element.querySelector('.command-panel__output')!;
    const field = input(harness.element);
    expect(output.lastElementChild?.contains(field)).toBe(true);
    expect(field.labels?.[0]?.textContent?.trim()).toBe('tyto ›');
    expect(field.getAttribute('aria-label')).toBe('Type a tyto command, then Enter');
    expect(output.hasAttribute('tabindex')).toBe(false);
  });

  it('takes the caret on a click in the output', async () => {
    const harness = await mount();
    await typeAndRun(harness, 'check a.brief');
    harness.element.querySelector<HTMLElement>('.command-run__header')!.click();
    expect(document.activeElement).toBe(input(harness.element));
  });

  it('says what to type only before anything has been run', async () => {
    const harness = await mount();
    expect(input(harness.element).placeholder).toBe('Type a tyto command, then Enter');
    await typeAndRun(harness, 'check a.brief');
    expect(input(harness.element).placeholder).toBe('');
  });
});

/** Two runs in one session: an older one that printed, and the newest. */
async function twoRuns(harness: Harness): Promise<void> {
  await typeAndRun(harness, 'plugin list');
  harness.sessions.output({ runId: 'run-1', stream: 'out', text: 'html\nsvg\n' });
  harness.sessions.state({ runId: 'run-1', state: 'finished', code: 0 });
  await typeAndRun(harness, 'check a.brief');
  harness.sessions.output({ runId: 'run-2', stream: 'err', text: 'error E_X\n' });
  await harness.element.updateComplete;
}

/** The output's children in order: a run by its header's command, the prompt as `›`. */
const layout = (element: HTMLElement) =>
  [...element.querySelector('.command-panel__output')!.children].map((child) =>
    child.classList.contains('command-panel__prompt-line')
      ? '›'
      : (child.querySelector('.command-run__command')?.textContent ?? '?'),
  );

describe('the runs’ order and folding (commandsOrder, commandsFoldOlderRuns)', () => {
  it('puts the newest run last and the prompt after it by default', async () => {
    const harness = await mount();
    await twoRuns(harness);
    expect(layout(harness.element)).toEqual(['plugin list', 'check a.brief', '›']);
    expect(harness.element.querySelector('.command-run__badge')?.textContent?.trim()).toBe('✓ 0');
  });

  it('puts the prompt first and the newest run under it with newestFirst, live', async () => {
    const harness = await mount();
    await twoRuns(harness);
    harness.element.order = 'newestFirst';
    await harness.element.updateComplete;
    expect(layout(harness.element)).toEqual(['›', 'check a.brief', 'plugin list']);
  });

  it('folds every run but the newest when told to, live, and opens one on a click', async () => {
    const harness = await mount();
    await twoRuns(harness);
    expect(lines(harness.element)).toEqual(['html', 'svg', 'error E_X']);
    harness.element.foldOlderRuns = true;
    await harness.element.updateComplete;
    expect(lines(harness.element)).toEqual(['error E_X']);
    const older = harness.element.querySelector<HTMLButtonElement>('button.command-run__header')!;
    expect(older.getAttribute('aria-expanded')).toBe('false');
    older.click();
    await harness.element.updateComplete;
    expect(lines(harness.element)).toEqual(['html', 'svg', 'error E_X']);
  });

  it('opens a folded run that holds a match of Ctrl+F', async () => {
    const harness = await mount();
    await twoRuns(harness);
    harness.element.foldOlderRuns = true;
    await harness.element.updateComplete;
    await press(harness.element, input(harness.element), 'f', { ctrlKey: true });
    const find = harness.element.querySelector<HTMLInputElement>('.command-panel__find-input')!;
    find.value = 'svg';
    find.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await harness.element.updateComplete;
    expect(lines(harness.element)).toEqual(['html', 'svg', 'error E_X']);
    expect(harness.element.querySelectorAll('.command-panel__match')).toHaveLength(1);
  });
});

/** A completion that offers the subcommands that start with what is typed, as the tree would. */
const subcommands: CommandPanelPorts['complete'] = (line, caret) => {
  const words = ['render', 'plugin', 'trust'].filter((word) => word.startsWith(line.trim()));
  return Promise.resolve({
    from: 0,
    to: caret,
    items: words.map((word) => ({ label: word, insert: word, continues: false })),
  });
};

/** Types `text` into the prompt the way a key does: the value, then an input event. */
async function typeInto(harness: Harness, text: string): Promise<void> {
  const field = input(harness.element);
  field.value = text;
  field.setSelectionRange(text.length, text.length);
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.element.updateComplete;
}

const suggestions = (element: HTMLElement) =>
  [...element.querySelectorAll('[role="option"]')].map(
    (option) => option.querySelector('.command-panel__suggestion-label')?.textContent,
  );

describe('completion (TYTO-496)', () => {
  it('lists what can come next as you type, and says so to a screen reader', async () => {
    const harness = await mount({ complete: subcommands });
    await typeInto(harness, 'r');
    expect(suggestions(harness.element)).toEqual(['render']);
    expect(input(harness.element).getAttribute('aria-expanded')).toBe('true');
    await typeInto(harness, '');
    expect(suggestions(harness.element)).toEqual([]);
  });

  it('takes the only suggestion on Tab, with a space after it', async () => {
    const harness = await mount({ complete: subcommands });
    input(harness.element).value = 'pl';
    await press(harness.element, input(harness.element), 'Tab');
    expect(input(harness.element).value).toBe('plugin ');
  });

  it('chooses with the arrows and takes the choice on Enter, without running', async () => {
    const harness = await mount({ complete: subcommands, history: ['trust list'] });
    // An empty line lists nothing as you type; Tab asks.
    await press(harness.element, input(harness.element), 'Tab');
    expect(suggestions(harness.element)).toEqual(['render', 'plugin', 'trust']);
    await press(harness.element, input(harness.element), 'ArrowDown');
    await press(harness.element, input(harness.element), 'ArrowDown');
    expect(input(harness.element).getAttribute('aria-activedescendant')).toBe(
      'command-suggestion-1',
    );
    await press(harness.element, input(harness.element), 'Enter');
    expect(input(harness.element).value).toBe('plugin ');
    expect(harness.ran).toEqual([]);
  });

  it('runs the line on Enter when no suggestion was chosen, and closes on Escape', async () => {
    const harness = await mount({ complete: subcommands });
    await typeInto(harness, 'tr');
    await press(harness.element, input(harness.element), 'Escape');
    expect(suggestions(harness.element)).toEqual([]);
    await typeInto(harness, 'trust');
    await press(harness.element, input(harness.element), 'Enter');
    expect(harness.ran).toEqual([['trust']]);
  });

  it('lists the suggestions right under the prompt, in either order', async () => {
    const harness = await mount({ complete: subcommands });
    await twoRuns(harness);
    await typeInto(harness, 'r');
    const after = (element: HTMLElement) =>
      element
        .querySelector('.command-panel__prompt-line')
        ?.nextElementSibling?.getAttribute('role');
    expect(after(harness.element)).toBe('listbox');
    harness.element.order = 'newestFirst';
    await harness.element.updateComplete;
    expect(after(harness.element)).toBe('listbox');
    expect(layout(harness.element)).toEqual(['›', '?', 'check a.brief', 'plugin list']);
  });

  it('takes a suggestion on a click', async () => {
    const harness = await mount({ complete: subcommands });
    await typeInto(harness, 'p');
    harness.element
      .querySelector('[role="option"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await harness.element.updateComplete;
    expect(input(harness.element).value).toBe('plugin ');
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
