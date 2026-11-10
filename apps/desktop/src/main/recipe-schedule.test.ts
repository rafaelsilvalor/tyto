import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diagnostic, ok } from '@tyto/core';
import {
  type RecipePlace,
  type RecipeRunInput,
  type RunnerAnswer,
  createRecipeRunner,
} from '@tyto/io';
import type { RecipeContributions } from '@tyto/plugin-api';
import type { RunClock, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ScheduleNotice,
  createRecipeSchedule,
  problemOf,
  walkRecipes,
} from './recipe-schedule.js';

/**
 * The recipe scheduler (TYTO-385, ADR 0175) on a real workspace folder, with fake timers for
 * the cadence and an injected `notify`, so no OS notification is ever shown. Most runs go to a
 * stand-in runner that records what it was asked; the trust tests use the real one.
 */

const MINUTE = 60_000;
const WATCH = 'recipe watch\nevery 5m\nacme.pull\n';

let scratch: string;
let workspace: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-08T12:00:00.000Z'));
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-schedule-')));
  workspace = join(scratch, 'promo');
  await mkdir(join(workspace, 'recipes'), { recursive: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(scratch, { recursive: true, force: true });
});

const clean: RunnerAnswer = {
  cells: [{ index: 0, line: 3, status: 'ok', diagnostics: [] }],
  diagnostics: [],
  ranAt: '',
};

const failing: RunnerAnswer = {
  cells: [
    {
      index: 0,
      line: 3,
      status: 'failed',
      diagnostics: [diagnostic('E_RECIPE_SOURCE', { verb: 'acme.pull', problem: 'is down' })],
    },
  ],
  diagnostics: [],
  ranAt: '',
};

/** A scheduler over `workspace` whose runner answers `answers` in turn, the last one after. */
function harness(answers: readonly RunnerAnswer[] = [clean]) {
  const asked: RecipeRunInput[] = [];
  const notices: ScheduleNotice[] = [];
  let gate: Promise<void> | undefined;
  const schedule = createRecipeSchedule({
    run: async (input) => {
      asked.push(input);
      const answer = answers[Math.min(asked.length - 1, answers.length - 1)] ?? clean;
      if (gate !== undefined) await gate;
      return answer;
    },
    notify: (notice) => notices.push(notice),
    changed: () => undefined,
  });
  /** Holds every run until the function it answers is called. */
  const hold = (): (() => void) => {
    let release = (): void => {};
    gate = new Promise((resolve) => {
      release = () => {
        gate = undefined;
        resolve();
      };
    });
    return release;
  };
  const advance = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    await schedule.idle();
  };
  return { schedule, asked, notices, hold, advance };
}

/**
 * Lets the disk answer: a run reads its file before it reaches the runner, and fake time does
 * not wait for that. `setImmediate` and `performance` are left real for this, and the wait is
 * bounded by real time, not by turns: a loaded CI machine took more than a thousand turns.
 */
async function until(done: () => boolean): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!done() && performance.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const write = (name: string, text: string) => writeFile(join(workspace, name), text, 'utf8');

describe('when a scheduled recipe runs', () => {
  it('runs twice in ten minutes at every 5m, the file on disk, as a scheduled run', async () => {
    await write('recipes/watch.recipe', WATCH);
    const { schedule, asked, advance } = harness();
    await schedule.setFolder(workspace);

    await advance(5 * MINUTE - 1);
    expect(asked).toHaveLength(0);
    await advance(1);
    expect(asked).toHaveLength(1);
    await advance(5 * MINUTE);

    expect(asked).toHaveLength(2);
    const real = await realpath(join(workspace, 'recipes', 'watch.recipe'));
    expect(asked[0]).toEqual({
      documentId: `schedule:${real}`,
      text: WATCH,
      path: real,
      scheduled: true,
      from: 0,
    });
    expect(schedule.list()).toEqual([
      expect.objectContaining({
        name: 'watch',
        file: 'recipes/watch.recipe',
        minutes: 5,
        needs: [],
        running: false,
        outcome: 'ok',
        lastRunAt: '2026-11-08T12:10:00.000Z',
        nextRunAt: '2026-11-08T12:15:00.000Z',
      }),
    ]);
  });

  it('skips a tick that finds the last run still going, and does not queue it', async () => {
    await write('watch.recipe', WATCH);
    const { schedule, asked, hold, advance } = harness();
    await schedule.setFolder(workspace);
    const release = hold();

    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    await until(() => asked.length === 1);
    expect(asked).toHaveLength(1);
    expect(schedule.list()[0]?.running).toBe(true);
    // The tick at ten minutes finds it running: skipped.
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(asked).toHaveLength(1);
    release();
    await schedule.idle();
    // Nothing queued ran on release; the next tick is one interval after the skipped one.
    expect(asked).toHaveLength(1);
    await advance(5 * MINUTE);
    expect(asked).toHaveLength(2);
  });

  it('runs a recipe whose time passed in sleep once on resume, with no burst', async () => {
    await write('watch.recipe', WATCH);
    const { schedule, asked, advance } = harness();
    await schedule.setFolder(workspace);

    // Forty minutes pass with no timer firing, as across a sleep.
    vi.setSystemTime(new Date('2026-11-08T12:40:00.000Z'));
    schedule.resumed();
    await schedule.idle();
    expect(asked).toHaveLength(1);
    schedule.resumed();
    await schedule.idle();
    expect(asked).toHaveLength(1);
    // And the cadence goes on from that run.
    expect(schedule.list()[0]?.nextRunAt).toBe('2026-11-08T12:45:00.000Z');
    await advance(5 * MINUTE);
    expect(asked).toHaveLength(2);
  });

  it('runs now by its id, and times the next one from that run', async () => {
    await write('watch.recipe', WATCH);
    const { schedule, asked, advance } = harness();
    await schedule.setFolder(workspace);
    await advance(2 * MINUTE);

    const id = schedule.list()[0]?.scheduleId ?? '';
    expect(schedule.runNow('/not/an/id')).toBe(false);
    expect(schedule.runNow(id)).toBe(true);
    await schedule.idle();

    expect(asked).toHaveLength(1);
    expect(schedule.pathOf(id)).toBe(await realpath(join(workspace, 'watch.recipe')));
    await advance(3 * MINUTE);
    expect(asked).toHaveLength(1);
    await advance(2 * MINUTE);
    expect(asked).toHaveLength(2);
  });

  it('stops when the window closes: no tick, and a run under way never notifies', async () => {
    await write('watch.recipe', WATCH);
    const { schedule, asked, notices, hold, advance } = harness([failing]);
    await schedule.setFolder(workspace);
    const release = hold();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    await until(() => asked.length === 1);
    expect(asked).toHaveLength(1);

    schedule.stop();
    release();
    await advance(60 * MINUTE);

    expect(asked).toHaveLength(1);
    expect(notices).toEqual([]);
    expect(schedule.list()).toEqual([]);
    expect(schedule.runNow('anything')).toBe(false);
  });
});

describe('which recipes are scheduled', () => {
  it('lists one whose param has no default as needing it, and never runs it', async () => {
    await write('weekly.recipe', 'recipe weekly\nevery 5m\nparam project\nacme.pull\n');
    const { schedule, asked, advance } = harness();
    await schedule.setFolder(workspace);

    await advance(30 * MINUTE);

    expect(asked).toHaveLength(0);
    const [entry] = schedule.list();
    expect(entry?.needs).toEqual(['project']);
    expect(entry?.nextRunAt).toBeUndefined();
    expect(schedule.runNow(entry?.scheduleId ?? '')).toBe(false);
  });

  it('skips a recipe without every, and what the explorer watcher skips', async () => {
    await write('watch.recipe', WATCH);
    await write('asked.recipe', 'recipe asked\nacme.pull\n');
    await mkdir(join(workspace, 'node_modules', 'x'), { recursive: true });
    await mkdir(join(workspace, '.git'), { recursive: true });
    await write('node_modules/x/hidden.recipe', WATCH);
    await write('.git/hidden.recipe', WATCH);
    const { schedule } = harness();

    await schedule.setFolder(workspace);

    expect(schedule.list().map((entry) => entry.file)).toEqual(['watch.recipe']);
    expect(await walkRecipes(workspace)).toHaveLength(2);
  });

  it('walks again only when a burst names a recipe', async () => {
    await write('watch.recipe', WATCH);
    const { schedule } = harness();
    await schedule.setFolder(workspace);
    await write('recipes/later.recipe', 'recipe later\nevery 1h\nacme.pull\n');

    schedule.filesChanged(['notes.md']);
    await schedule.idle();
    expect(schedule.list()).toHaveLength(1);

    schedule.filesChanged([join('recipes', 'later.recipe')]);
    await schedule.idle();
    expect(schedule.list().map((entry) => [entry.file, entry.minutes])).toEqual([
      ['recipes/later.recipe', 60],
      ['watch.recipe', 5],
    ]);

    await rm(join(workspace, 'watch.recipe'));
    schedule.filesChanged([null]);
    await schedule.idle();
    expect(schedule.list().map((entry) => entry.file)).toEqual(['recipes/later.recipe']);
  });
});

describe('how loud it is', () => {
  it('notifies on the first problem, then not until a clean run has reset it', async () => {
    await write('watch.recipe', WATCH);
    const { schedule, notices, advance } = harness([failing, failing, clean, failing]);
    await schedule.setFolder(workspace);

    await advance(5 * MINUTE);
    expect(notices).toHaveLength(1);
    await advance(5 * MINUTE);
    expect(notices).toHaveLength(1);
    expect(schedule.list()[0]).toEqual(
      expect.objectContaining({ outcome: 'problem', code: 'E_RECIPE_SOURCE' }),
    );
    await advance(5 * MINUTE);
    expect(notices).toHaveLength(1);
    expect(schedule.list()[0]?.outcome).toBe('ok');
    await advance(5 * MINUTE);

    expect(notices).toHaveLength(2);
    // The recipe's name and the code, never a row's values.
    expect(notices[0]).toEqual({
      scheduleId: schedule.list()[0]?.scheduleId,
      recipe: 'watch',
      problem: { kind: 'diagnostic', code: 'E_RECIPE_SOURCE' },
    });
  });

  it('calls a waiting plan no problem, and a failed operation of an applied plan one', () => {
    const plan = { target: 't', operations: [], count: 1 };
    expect(
      problemOf({
        ...clean,
        cells: [{ index: 0, line: 2, status: 'ok', diagnostics: [], plan, applicable: true }],
      }),
    ).toBeUndefined();
    expect(
      problemOf({
        ...clean,
        cells: [
          {
            index: 0,
            line: 2,
            status: 'ok',
            diagnostics: [],
            applied: {
              at: '',
              operations: [
                { rowKey: 'A-1', status: 'applied', appliedAt: '' },
                { rowKey: 'A-2', status: 'failed', reason: 'A-2 holds a private value' },
              ],
            },
          },
        ],
      }),
    ).toEqual({ kind: 'operations', failed: 1 });
    expect(problemOf({ ...clean, held: 'restricted' })).toBeUndefined();
  });
});

describe('a scheduled run through the real runner', () => {
  const TASKS: Table = {
    columns: [{ name: 'key', type: 'text', origin: 'acme' }],
    rows: [
      {
        key: 'T-1',
        values: { key: 'T-1' },
        provenance: { source: 'acme', id: 'T-1', fetchedAt: '2026-11-08T11:00:00.000Z' },
      },
    ],
  };
  const clock: RunClock = { now: () => new Date(), offsetMinutes: () => 0 };

  function realHarness(trust: RecipePlace['trust']) {
    const calls = { pull: 0 };
    const contributions: RecipeContributions = {
      recipeVerbs: () => [pull],
      ownedRecipeVerbs: () => [{ plugin: 'acme', verb: pull }],
      recipeDerivations: () => [],
    };
    const pull = {
      id: 'acme.pull',
      kind: 'source' as const,
      arguments: [],
      page: () => {
        calls.pull += 1;
        return Promise.resolve(ok({ table: TASKS }));
      },
    };
    const runner = createRecipeRunner({
      contributions,
      placeOf: () => Promise.resolve(trust === 'none' ? { trust } : { trust, folder: workspace }),
      sectionFor: () => undefined,
      home: join(scratch, 'home'),
      clock: () => clock,
    });
    const notices: ScheduleNotice[] = [];
    const schedule = createRecipeSchedule({
      run: (input) => runner.run(input),
      notify: (notice) => notices.push(notice),
      changed: () => undefined,
    });
    return { calls, notices, schedule };
  }

  it('fetches in a trusted folder on every tick', async () => {
    await write('watch.recipe', WATCH);
    const { calls, schedule } = realHarness('trusted');
    await schedule.setFolder(workspace);

    for (let tick = 0; tick < 2; tick += 1) {
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      await schedule.idle();
    }

    // Each run starts from the first cell, so the source fetches again.
    expect(calls.pull).toBe(2);
    expect(schedule.list()[0]?.outcome).toBe('ok');
  });

  it('never runs in a restricted folder or outside a workspace, and stays quiet', async () => {
    await write('watch.recipe', WATCH);
    for (const trust of ['restricted', 'none'] as const) {
      const { calls, notices, schedule } = realHarness(trust);
      await schedule.setFolder(workspace);

      await vi.advanceTimersByTimeAsync(15 * MINUTE);
      await schedule.idle();

      expect(calls.pull).toBe(0);
      expect(notices).toEqual([]);
      expect(schedule.list().map((entry) => entry.outcome)).toEqual(['held']);
      schedule.stop();
    }
  });
});
