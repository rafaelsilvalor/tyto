// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import { toggleDockCommandId } from './commands.js';
import { type StatusBar, type StatusBarState, STATUS_BAR_TAG, positionText } from './status-bar.js';

/**
 * The status bar's facts and buttons (TYTO-248, ADR 0076), drawn in jsdom.
 *
 * What jsdom cannot say is whether the bar is one line — it does no layout — so that is
 * measured in the real window by `e2e/status-bar.desktop.test.ts`.
 */

const COMMANDS = {
  commandBar: 'commandBar.toggle',
  problems: 'layout.togglePanel:problems',
  queue: 'layout.togglePanel:queue',
  plugins: 'plugins.show',
  export: 'file.export',
  settings: 'settings.open',
};

const base: StatusBarState = {
  locale: 'en',
  vim: null,
  cursor: { line: 4, column: 17, selected: 0 },
  kind: 'brief',
  template: 'promo-curso',
  problems: 3,
  errors: 1,
  newProblems: false,
  shown: { left: false, right: true, bottom: true, problems: true, queue: false },
};

const mount = async (state: StatusBarState = base): Promise<{ bar: StatusBar; ran: string[] }> => {
  const bar = document.createElement(STATUS_BAR_TAG);
  const ran: string[] = [];
  bar.commands = COMMANDS;
  bar.run = (id) => {
    ran.push(id);
  };
  bar.state = state;
  document.body.append(bar);
  await bar.updateComplete;
  return { bar, ran };
};

const buttons = (bar: StatusBar): HTMLButtonElement[] => [
  ...bar.querySelectorAll<HTMLButtonElement>('.status-bar__button'),
];

afterEach(() => {
  document.body.replaceChildren();
});

describe('the status bar', () => {
  it('runs a command per button, in the approved order, each by id', async () => {
    const { bar, ran } = await mount();

    for (const button of buttons(bar)) button.click();

    expect(ran).toEqual([
      toggleDockCommandId('left'),
      COMMANDS.commandBar,
      COMMANDS.problems,
      COMMANDS.queue,
      COMMANDS.plugins,
      COMMANDS.export,
      COMMANDS.settings,
      toggleDockCommandId('bottom'),
      toggleDockCommandId('right'),
    ]);
  });

  it('labels every button from the catalogue, in both languages', async () => {
    for (const locale of ['en', 'pt-BR'] as const) {
      const { bar } = await mount({ ...base, locale });
      const labels = buttons(bar).map((button) => button.getAttribute('aria-label'));

      expect(labels.every((label) => label !== null && label !== '')).toBe(true);
      expect(labels[0]).toBe(translate(locale, 'command.layout.toggleDock.left'));
      expect(labels[1]).toBe(translate(locale, 'status.commandBar'));
      document.body.replaceChildren();
    }
  });

  it('marks a shown area and an open panel as on, and nothing else', async () => {
    const { bar } = await mount();
    const on = buttons(bar)
      .filter((button) => button.classList.contains('status-bar__button--on'))
      .map((button) => button.dataset['command']);

    expect(on).toEqual([
      COMMANDS.problems,
      toggleDockCommandId('bottom'),
      toggleDockCommandId('right'),
    ]);
  });

  it('holds the problem count inside the problems button, coloured while an error is in it', async () => {
    const { bar } = await mount();
    const count = bar.querySelector(`[data-command="${COMMANDS.problems}"] .status-bar__count`);

    expect(count?.textContent).toBe('3');
    expect(count?.classList.contains('status-bar__count--bad')).toBe(true);

    bar.state = { ...base, problems: 0, errors: 0 };
    await bar.updateComplete;
    expect(count?.textContent).toBe('0');
    expect(count?.classList.contains('status-bar__count--bad')).toBe(false);
  });

  it('draws the "new" dot beside the count only while new problems are flagged (TYTO-143)', async () => {
    const problemsButton = (bar: StatusBar): HTMLButtonElement =>
      bar.querySelector<HTMLButtonElement>(`[data-command="${COMMANDS.problems}"]`)!;

    const quiet = (await mount({ ...base, newProblems: false })).bar;
    expect(problemsButton(quiet).querySelector('.status-bar__new')).toBeNull();
    expect(problemsButton(quiet).getAttribute('aria-label')).not.toContain(
      translate('en', 'status.problems.new'),
    );
    document.body.replaceChildren();

    for (const locale of ['en', 'pt-BR'] as const) {
      const { bar } = await mount({ ...base, locale, newProblems: true });
      const button = problemsButton(bar);
      const dot = button.querySelector('.status-bar__new');
      expect(dot).not.toBeNull();
      // After the count, inside the same button: the number says how many, the dot says new.
      expect(dot?.previousElementSibling?.classList.contains('status-bar__count')).toBe(true);
      expect(dot?.getAttribute('aria-hidden')).toBe('true');
      expect(button.getAttribute('aria-label')).toContain(translate(locale, 'status.problems.new'));
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
      document.body.replaceChildren();
    }
  });

  it('shows the vim mode and its pending keys only while vim is on', async () => {
    const { bar } = await mount();
    expect(bar.querySelector('.status-bar__vim')).toBeNull();

    bar.state = { ...base, vim: { mode: 'visual line', pending: '2d' } };
    await bar.updateComplete;

    expect(bar.querySelector('.status-bar__vim')?.textContent).toBe('VISUAL LINE');
    expect(bar.querySelector('.status-bar__pending')?.textContent).toBe('2d');
  });

  it('says the tab kind and the template, and no template for a settings tab', async () => {
    const { bar } = await mount();
    expect(bar.querySelector('.status-bar__kind')?.textContent).toBe('Brief');
    expect(bar.querySelector('.status-bar__template')?.textContent).toBe('promo-curso');

    bar.state = { ...base, kind: 'settings', template: undefined };
    await bar.updateComplete;
    expect(bar.querySelector('.status-bar__kind')?.textContent).toBe(
      translate('en', 'status.kind.settings'),
    );
    expect(bar.querySelector('.status-bar__template')).toBeNull();
  });
});

describe('positionText', () => {
  it('says line and column, and the selection only when there is one', () => {
    expect(positionText(base)).toBe('Ln 4, Col 17');
    expect(positionText({ ...base, cursor: { line: 4, column: 17, selected: 7 } })).toBe(
      'Ln 4, Col 17 (7 selected)',
    );
    expect(positionText({ ...base, locale: 'pt-BR' })).toBe('Lin 4, Col 17');
  });
});
