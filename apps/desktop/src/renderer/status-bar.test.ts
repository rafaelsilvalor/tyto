// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import { STATUS_BAR_ITEM_IDS } from '../../shared/status-bar-items.js';
import { toggleDockCommandId } from './commands.js';
import {
  type StatusBar,
  type StatusBarState,
  STATUS_BAR_TAG,
  paintVimStyle,
  positionText,
  vimBadgeMode,
} from './status-bar.js';

/**
 * The status bar's facts and buttons (TYTO-248, ADR 0076), drawn in jsdom.
 *
 * What jsdom cannot say is whether the bar is one line — it does no layout — so that is
 * measured in the real window by `e2e/status-bar.desktop.test.ts`.
 */

const COMMANDS = {
  commandBar: 'commandBar.toggle',
  problems: 'layout.togglePanel:problems',
  explorer: 'layout.togglePanel:explorer',
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
  shown: {
    left: false,
    right: true,
    bottom: true,
    problems: true,
    explorer: false,
    queue: false,
  },
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
      COMMANDS.explorer,
      COMMANDS.queue,
      COMMANDS.plugins,
      COMMANDS.export,
      COMMANDS.settings,
      toggleDockCommandId('bottom'),
      toggleDockCommandId('right'),
    ]);
  });

  it('greys a button whose command is not offered with the tab in front (TYTO-283)', async () => {
    const { bar } = await mount({ ...base, kind: 'settings' });
    bar.offered = (id) => id !== COMMANDS.export;
    bar.requestUpdate();
    await bar.updateComplete;

    const disabled = buttons(bar)
      .filter((button) => button.disabled)
      .map((button) => button.dataset['command']);
    expect(disabled).toEqual([COMMANDS.export]);
  });

  it('draws no Export button with a text file or a Markdown preview in front (TYTO-247)', async () => {
    const exportDrawn = (bar: StatusBar): boolean =>
      buttons(bar).some((button) => button.dataset['command'] === COMMANDS.export);
    for (const kind of ['text', 'markdown', 'markdown-preview'] as const) {
      const { bar } = await mount({ ...base, kind });
      expect([kind, exportDrawn(bar)]).toEqual([kind, false]);
    }
    for (const kind of ['brief', 'preview', 'settings'] as const) {
      const { bar } = await mount({ ...base, kind });
      expect([kind, exportDrawn(bar)]).toEqual([kind, true]);
    }
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
    // TYTO-267: `aria-label` hides the visible number from a screen reader, so the label
    // says it too — the panel heading's own count, the one that used to be heard, is gone.
    expect(count?.closest('button')?.getAttribute('aria-label')).toContain('(3)');

    bar.state = { ...base, problems: 0, errors: 0 };
    await bar.updateComplete;
    expect(count?.textContent).toBe('0');
    expect(count?.closest('button')?.getAttribute('aria-label')).toContain('(0)');
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

  // TYTO-301: the badge's colour is the theme's for the mode, picked in CSS by `data-mode`.
  // Visual line and block are visual; the library reports no other mode.
  it.each([
    ['normal', 'normal'],
    ['insert', 'insert'],
    ['visual', 'visual'],
    ['visual line', 'visual'],
    ['visual block', 'visual'],
    ['replace', 'replace'],
  ])('marks vim’s %s mode as %s for the badge’s colour', async (mode, badge) => {
    const { bar } = await mount({ ...base, vim: { mode, pending: '' } });
    expect(bar.querySelector('.status-bar__vim')?.getAttribute('data-mode')).toBe(badge);
    expect(vimBadgeMode(mode)).toBe(badge);
  });

  it('draws a mode it does not know as normal rather than with no colour', () => {
    expect(vimBadgeMode('operator-pending')).toBe('normal');
    expect(vimBadgeMode('')).toBe('normal');
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

  it('names a text tab: Plain text for a .txt and Markdown for a .md (TYTO-247)', async () => {
    const { bar } = await mount();
    const kindText = async (kind: 'text' | 'markdown', locale: 'en' | 'pt-BR') => {
      bar.state = { ...base, kind, locale, template: undefined };
      await bar.updateComplete;
      return bar.querySelector('.status-bar__kind')?.textContent;
    };
    expect(await kindText('text', 'en')).toBe('Plain text');
    expect(await kindText('text', 'pt-BR')).toBe('Texto simples');
    expect(await kindText('markdown', 'en')).toBe('Markdown');
    expect(await kindText('markdown', 'pt-BR')).toBe('Markdown');
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

describe('the statusBarItems setting (TYTO-301, ADR 0091)', () => {
  /** The ids drawn on each side, in order, once per item (vim's two spans are one item). */
  const drawn = (bar: StatusBar): { start: string[]; end: string[] } => {
    const side = (selector: string): string[] => [
      ...new Set(
        [...bar.querySelectorAll<HTMLElement>(`${selector} [data-item]`)].map(
          (element) => element.dataset['item'] ?? '',
        ),
      ),
    ];
    return {
      start: side('.status-bar__side:not(.status-bar__side--end)'),
      end: side('.status-bar__side--end'),
    };
  };

  it('draws today’s bar, every item in ADR 0076’s order, when the setting says nothing', async () => {
    const { bar } = await mount({ ...base, vim: { mode: 'normal', pending: '' } });

    expect(drawn(bar)).toEqual({
      start: ['leftArea', 'commandBar', 'vimMode'],
      end: [
        'cursorPosition',
        'tabKind',
        'template',
        'problems',
        'explorer',
        'queue',
        'plugins',
        'export',
        'settings',
        'bottomArea',
        'rightArea',
      ],
    });
  });

  it('lights the explorer button while its panel is on screen (TYTO-279)', async () => {
    const { bar } = await mount({ ...base, shown: { ...base.shown, explorer: true } });
    const button = bar.querySelector<HTMLButtonElement>('button[data-item="explorer"]');

    expect(button?.getAttribute('aria-label')).toBe('Show or hide: Explorer');
    expect(button?.classList.contains('status-bar__button--on')).toBe(true);
  });

  it('leaves out an item the list does not name', async () => {
    const { bar } = await mount();
    bar.items = STATUS_BAR_ITEM_IDS.filter((id) => id !== 'template' && id !== 'queue');
    await bar.updateComplete;

    expect(bar.querySelector('.status-bar__template')).toBeNull();
    expect(drawn(bar).end).not.toContain('queue');
    expect(drawn(bar).end).toContain('problems');
  });

  it('orders each side by the list, and never moves an item to the other side', async () => {
    const { bar } = await mount();
    bar.items = ['settings', 'commandBar', 'cursorPosition', 'leftArea', 'problems'];
    await bar.updateComplete;

    expect(drawn(bar)).toEqual({
      start: ['commandBar', 'leftArea'],
      end: ['settings', 'cursorPosition', 'problems'],
    });
  });

  it('draws an empty bar for an empty list', async () => {
    const { bar } = await mount();
    bar.items = [];
    await bar.updateComplete;

    expect(drawn(bar)).toEqual({ start: [], end: [] });
  });

  it('still draws a named item only when it has something to show', async () => {
    const { bar } = await mount({ ...base, template: undefined, vim: null });
    bar.items = ['vimMode', 'template', 'export'];
    await bar.updateComplete;

    expect(drawn(bar)).toEqual({ start: [], end: ['export'] });
  });
});

describe('the vimModeStyle setting on the bar (TYTO-301, ADR 0091)', () => {
  it('names the style on the footer, and the mode only while vim is on', () => {
    const foot = document.createElement('footer');

    paintVimStyle(foot, 'bar', { mode: 'visual line', pending: '' });
    expect({ ...foot.dataset }).toEqual({ vimStyle: 'bar', vimMode: 'visual' });

    paintVimStyle(foot, 'border', { mode: 'insert', pending: '' });
    expect({ ...foot.dataset }).toEqual({ vimStyle: 'border', vimMode: 'insert' });

    // Vim off: no mode, so every style is the plain bar.
    paintVimStyle(foot, 'bar', null);
    expect({ ...foot.dataset }).toEqual({ vimStyle: 'bar' });
  });
});
