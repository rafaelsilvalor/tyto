// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  type ScheduleActions,
  type ScheduleListView,
  type SchedulePanel,
  type ScheduleRow,
  SCHEDULE_PANEL_TAG,
  cadenceOf,
  clockOf,
} from './schedule-panel.js';

/**
 * The Schedules panel (TYTO-385, ADR 0175 decision 6) as jsdom can see it: a row per scheduled
 * recipe with its times and how its last run ended, in both languages, and the two buttons
 * handing back main's id. Where it sits in the bottom strip, and that a real run shows up in it,
 * is `e2e/schedules.desktop.test.ts`'s.
 */

const row = (overrides: Partial<ScheduleRow> = {}): ScheduleRow => ({
  scheduleId: 's-1',
  name: 'weekly',
  file: 'recipes/weekly.recipe',
  minutes: 5,
  needs: [],
  running: false,
  ...overrides,
});

const list = (...schedules: ScheduleRow[]): ScheduleListView => ({ schedules });

async function panel(
  shown: SchedulePanel['view'],
  locale: 'en' | 'pt-BR' = 'en',
  actions?: ScheduleActions,
) {
  document.body.innerHTML = `<${SCHEDULE_PANEL_TAG}></${SCHEDULE_PANEL_TAG}>`;
  const element = document.querySelector<SchedulePanel>(SCHEDULE_PANEL_TAG)!;
  element.locale = locale;
  element.view = shown;
  if (actions !== undefined) element.actions = actions;
  await element.updateComplete;
  return element;
}

const cells = (element: HTMLElement, scheduleId: string) => {
  const found = element.querySelector(`.schedules__row[data-schedule="${scheduleId}"]`);
  return {
    name: found?.querySelector('.schedules__name')?.textContent?.trim(),
    every: found?.querySelector('.schedules__every')?.textContent?.trim(),
    last: found?.querySelector('.schedules__last time')?.getAttribute('datetime') ?? undefined,
    next: found?.querySelector('.schedules__next time')?.getAttribute('datetime') ?? undefined,
    outcome: found?.querySelector('.schedules__outcome')?.textContent?.trim(),
    state: found?.querySelector('.schedules__outcome')?.getAttribute('data-outcome'),
    runDisabled: found?.querySelector<HTMLButtonElement>('.schedules__run')?.disabled,
  };
};

describe('the Schedules panel', () => {
  it('draws a row per recipe: name, cadence, last and next run, and the outcome', async () => {
    const element = await panel(
      list(
        row({
          lastRunAt: '2026-11-11T09:00:00.000Z',
          nextRunAt: '2026-11-11T09:05:00.000Z',
          outcome: 'problem',
          code: 'E_RECIPE_NO_INPUT',
        }),
        row({ scheduleId: 's-2', name: 'daily', minutes: 120, outcome: 'ok' }),
      ),
    );
    expect(cells(element, 's-1')).toEqual({
      name: 'weekly',
      every: 'every 5m',
      last: '2026-11-11T09:00:00.000Z',
      next: '2026-11-11T09:05:00.000Z',
      outcome: 'problem: E_RECIPE_NO_INPUT',
      state: 'problem',
      runDisabled: false,
    });
    expect(cells(element, 's-2')).toMatchObject({ every: 'every 2h', outcome: 'ok', state: 'ok' });
    expect(element.querySelector('.schedules__name')?.getAttribute('title')).toBe(
      'recipes/weekly.recipe',
    );
  });

  it('says each outcome, in Portuguese too', async () => {
    const shown = list(
      row({ scheduleId: 'none' }),
      row({ scheduleId: 'held', outcome: 'held' }),
      row({ scheduleId: 'waiting', outcome: 'waiting' }),
      row({ scheduleId: 'running', running: true, outcome: 'ok' }),
      row({ scheduleId: 'needs', needs: ['project', 'team'], nextRunAt: '2026-11-11T09:05:00Z' }),
      row({ scheduleId: 'bare', outcome: 'problem' }),
    );
    const english = await panel(shown);
    const said = (element: HTMLElement) =>
      ['none', 'held', 'waiting', 'running', 'needs', 'bare'].map(
        (id) => cells(element, id).outcome,
      );
    expect(said(english)).toEqual([
      'not run yet',
      'held: restricted folder',
      'plan waiting for Apply',
      'running',
      'needs project, team',
      'problem',
    ]);
    // A recipe needing a parameter is never run, so it has no next run and no Run now.
    expect(cells(english, 'needs')).toMatchObject({ next: undefined, runDisabled: true });
    expect(cells(english, 'running').runDisabled).toBe(true);

    const portuguese = await panel(shown, 'pt-BR');
    expect(said(portuguese)).toEqual([
      'ainda não rodou',
      'retida: pasta restrita',
      'plano aguardando Aplicar',
      'rodando',
      'precisa de project, team',
      'problema',
    ]);
    expect(portuguese.querySelector('.schedules__run')?.textContent?.trim()).toBe('Rodar agora');
    expect(portuguese.querySelector('.tool__title')?.getAttribute('data-i18n')).toBe(
      'schedules.heading',
    );
  });

  it("hands back main's id from Run now and Open, never the file", async () => {
    const actions = { runNow: vi.fn(), open: vi.fn() };
    const element = await panel(
      list(row({ scheduleId: 'first' }), row({ scheduleId: 'second', name: 'other' })),
      'en',
      actions,
    );
    element.querySelector<HTMLButtonElement>('[data-schedule="second"] .schedules__run')?.click();
    element.querySelector<HTMLButtonElement>('[data-schedule="first"] .schedules__open')?.click();
    expect(actions.runNow.mock.calls).toEqual([['second']]);
    expect(actions.open.mock.calls).toEqual([['first']]);
  });

  it('says when nothing is scheduled, when main could not answer, and nothing before', async () => {
    expect((await panel(list())).querySelector('.schedules__empty')?.textContent).toContain(
      'every 30m',
    );
    expect((await panel('failed')).querySelector('.schedules__note--bad')).not.toBeNull();
    const asked = await panel(undefined);
    expect(asked.querySelector('.schedules__note')).toBeNull();
    expect(asked.querySelector('.schedules__table')).toBeNull();
  });
});

describe('the words a row is written in', () => {
  it('writes the cadence as the header does', () => {
    expect([5, 90, 60, 120].map(cadenceOf)).toEqual([
      'every 5m',
      'every 90m',
      'every 1h',
      'every 2h',
    ]);
  });

  it('writes a time as the language does, and nothing for none or garbage', () => {
    const iso = '2026-11-11T09:05:00.000Z';
    expect(clockOf(iso, 'en')).toBe(
      new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
    );
    expect(clockOf(undefined, 'en')).toBe('');
    expect(clockOf('not a time', 'en')).toBe('');
  });
});
