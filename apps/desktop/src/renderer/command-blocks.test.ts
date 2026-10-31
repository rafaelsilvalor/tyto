import { describe, expect, it } from 'vitest';

import {
  blocksOf,
  inRunOrder,
  isFolded,
  sectionTitle,
  shortCommand,
  startTime,
} from './command-blocks.js';
import { lineText } from './command-output.js';
import { CommandSessions } from './command-sessions.js';

/**
 * The command panel's runs as blocks (TYTO-496): a block per run in the order `commandsOrder`
 * asks for, the header's short command, and when `commandsFoldOlderRuns` folds one.
 */

function twoRuns(): CommandSessions {
  const sessions = new CommandSessions();
  const id = sessions.active.id;
  sessions.started(id, 'plugin list', ['plugin', 'list'], 'run-1', Date.UTC(2026, 9, 30, 21, 40));
  sessions.output({ runId: 'run-1', stream: 'out', text: 'html\nsvg\n' });
  sessions.state({ runId: 'run-1', state: 'finished', code: 0 });
  sessions.started(
    id,
    'render a.brief',
    ['render', 'a.brief'],
    'run-2',
    Date.UTC(2026, 9, 30, 21, 42),
  );
  sessions.output({ runId: 'run-2', stream: 'err', text: 'error E_X\n' });
  return sessions;
}

const shape = (sessions: CommandSessions, order: 'newestLast' | 'newestFirst') =>
  blocksOf(sessions.active, order).map(
    (block) =>
      `${block.run.line} [${block.run.state}] ${block.lines.map(({ line }) => lineText(line)).join('|')}`,
  );

describe('the runs as blocks', () => {
  it('puts each run’s lines under it, the newest last by default', () => {
    expect(shape(twoRuns(), 'newestLast')).toEqual([
      'plugin list [finished] html|svg',
      'render a.brief [running] error E_X',
    ]);
  });

  it('puts the newest first when the setting says so, each block’s lines still in order', () => {
    expect(shape(twoRuns(), 'newestFirst')).toEqual([
      'render a.brief [running] error E_X',
      'plugin list [finished] html|svg',
    ]);
  });

  it('gives a refused line a block of its own, with the reason and no exit code', () => {
    const sessions = twoRuns();
    sessions.refused(sessions.active.id, 'render "a', 'A quote is not closed.');
    const last = blocksOf(sessions.active, 'newestLast').at(-1);
    expect(last?.run).toMatchObject({ line: 'render "a', state: 'refused' });
    expect(last?.run.code).toBeUndefined();
    expect(last?.lines.map(({ line }) => lineText(line))).toEqual(['A quote is not closed.']);
  });

  it('keeps the exit code on the run it belongs to', () => {
    const sessions = twoRuns();
    sessions.state({ runId: 'run-2', state: 'finished', code: 1 });
    expect(sessions.active.runs.map((run) => run.code)).toEqual([0, 1]);
    expect(sessions.runOf('run-1')?.line).toBe('plugin list');
  });
});

describe('the header', () => {
  it('cuts each path to its file name and keeps the rest of the line', () => {
    expect(
      shortCommand('tyto render "C:\\Meus trabalhos\\perdido.brief" --out C:\\x\\out --types svg'),
    ).toBe('render perdido.brief --out out --types svg');
    expect(shortCommand('render "a')).toBe('render "a');
  });

  it('says when the run started, in hours and minutes', () => {
    const run = twoRuns().active.runs[0]!;
    expect(startTime(run, 'en')).toMatch(/^\d{1,2}:\d{2}/u);
  });
});

describe('folding the older runs', () => {
  const blocks = blocksOf(twoRuns().active, 'newestLast');
  const [older, newest] = [blocks[0]!, blocks[1]!];

  it('folds every run but the newest when the setting is on, and none when it is off', () => {
    expect(isFolded(older, 2, true, new Set(), new Set())).toBe(true);
    expect(isFolded(newest, 2, true, new Set(), new Set())).toBe(false);
    expect(isFolded(older, 2, false, new Set(), new Set())).toBe(false);
  });

  it('opens a run a person opened, and one find has a match in', () => {
    expect(isFolded(older, 2, true, new Set([1]), new Set())).toBe(false);
    const matched = new Set([older.lines[1]!.index]);
    expect(isFolded(older, 2, true, new Set(), matched)).toBe(false);
  });
});

describe('Problems’ command sections', () => {
  it('follow the same order as the runs', () => {
    expect(inRunOrder(['older', 'newer'], 'newestLast')).toEqual(['older', 'newer']);
    expect(inRunOrder(['older', 'newer'], 'newestFirst')).toEqual(['newer', 'older']);
  });

  it('are titled as the run’s header: the short command, the time and how it ended', () => {
    const run = { ...twoRuns().active.runs[1]!, line: 'render "C:\\x\\perdido.brief"' };
    expect(sectionTitle(run, 'en', 'exit 1')).toMatch(
      /^render perdido\.brief · \d{1,2}:\d{2}.* · exit 1$/u,
    );
  });
});
