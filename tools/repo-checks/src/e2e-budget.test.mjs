import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  annotations,
  BUDGET_PATH,
  budgetProblems,
  DESKTOP,
  judge,
  summarize,
  TABLE_ROWS,
} from './e2e-budget.mjs';

/**
 * The desktop e2e time budget (TYTO-310, ADR 0105). The cases are the ways it must turn red —
 * a file over the ceiling, a waived file over its own cap, a report it cannot read — and the
 * things it reports without failing: the table, seconds per test, and a stale waiver.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const script = fileURLToPath(new URL('./e2e-budget.mjs', import.meta.url));

const budget = { ceilingMs: 60_000, reason: 'test', waivers: {} };
const file = (name, durationMs, tests = 1) => ({
  file: `e2e/${name}.desktop.test.ts`,
  tests,
  durationMs,
});

describe('judge', () => {
  it('fails a file over the ceiling, naming it and its seconds', () => {
    const verdict = judge([file('fast', 5_000), file('slow', 70_400)], budget);
    expect(verdict.offenders.map((row) => row.file)).toEqual(['e2e/slow.desktop.test.ts']);
    expect(annotations(verdict)).toEqual([
      `::error file=${DESKTOP}/e2e/slow.desktop.test.ts::e2e/slow.desktop.test.ts took 70.4 s, ceiling 60.0 s`,
    ]);
  });

  it('passes a file exactly at the ceiling', () => {
    expect(judge([file('edge', 60_000)], budget).offenders).toEqual([]);
  });

  it('passes a waived file under its own cap, and fails it over that cap', () => {
    const waived = {
      ...budget,
      waivers: { 'e2e/slow.desktop.test.ts': { ceilingMs: 90_000, card: 'TYTO-1', reason: 'r' } },
    };
    expect(judge([file('slow', 80_000)], waived).offenders).toEqual([]);
    const over = judge([file('slow', 95_000)], waived);
    expect(over.offenders.map((row) => [row.file, row.ceilingMs])).toEqual([
      ['e2e/slow.desktop.test.ts', 90_000],
    ]);
    expect(annotations(over)[0]).toContain('took 95.0 s, ceiling 90.0 s');
  });

  it('flags a waiver whose file is back under the ceiling as stale, without failing', () => {
    const waived = {
      ...budget,
      waivers: { 'e2e/fixed.desktop.test.ts': { ceilingMs: 90_000, card: 'TYTO-1', reason: 'r' } },
    };
    const verdict = judge([file('fixed', 20_000)], waived);
    expect(verdict.offenders).toEqual([]);
    expect(verdict.staleWaivers).toEqual(['e2e/fixed.desktop.test.ts']);
    expect(summarize(verdict, waived)).toContain('TYTO-1 (stale)');
    expect(annotations(verdict)[0]).toMatch(/^::warning .*waiver is stale$/u);
  });

  it('sorts the rows slowest first and reports seconds per test', () => {
    const verdict = judge([file('a', 10_000, 4), file('b', 30_000, 3), file('c', 20_000)], budget);
    expect(verdict.rows.map((row) => [row.file, row.perTestMs])).toEqual([
      ['e2e/b.desktop.test.ts', 10_000],
      ['e2e/c.desktop.test.ts', 20_000],
      ['e2e/a.desktop.test.ts', 2_500],
    ]);
  });

  it.each([
    ['not a list', { file: 'x' }],
    ['an empty list', []],
    ['an entry without a file', [{ tests: 1, durationMs: 3 }]],
    ['a duration that is not a number', [{ file: 'e2e/x', tests: 1, durationMs: '3' }]],
    ['a negative duration', [{ file: 'e2e/x', tests: 1, durationMs: -1 }]],
    ['a test count that is not an integer', [{ file: 'e2e/x', tests: 1.5, durationMs: 3 }]],
  ])('fails a malformed report: %s', (_name, report) => {
    const verdict = judge(report, budget);
    expect(verdict.problems).not.toEqual([]);
    expect(annotations(verdict)[0]).toMatch(/^::error::e2e budget: /u);
  });

  it('fails a budget without a reason, or a waiver without a card', () => {
    expect(budgetProblems({ ceilingMs: 60_000, waivers: {} })).toEqual([
      '`reason` is missing: the number needs its reason beside it',
    ]);
    expect(
      budgetProblems({
        ...budget,
        waivers: { 'e2e/x.desktop.test.ts': { ceilingMs: 90_000, reason: 'r' } },
      }),
    ).toEqual(['the waiver for e2e/x.desktop.test.ts has no owner `card` (TYTO-<n>)']);
  });
});

describe('summarize', () => {
  it(`lists the ${TABLE_ROWS} slowest files, slowest first, and every offender`, () => {
    const report = Array.from({ length: 14 }, (_, index) => file(`f${index}`, (index + 1) * 1_000));
    const verdict = judge(report, budget);
    const rows = summarize(verdict, budget)
      .split('\n')
      .filter((line) => line.startsWith('| ') && line.includes('`e2e/'));
    expect(rows).toHaveLength(TABLE_ROWS);
    expect(rows[0]).toContain('`e2e/f13.desktop.test.ts` | 1 | 14.0 | 14.0 | 60.0 |');
    expect(rows.at(-1)).toContain('`e2e/f4.desktop.test.ts`');
  });

  it('heads the table with how many files are over', () => {
    const verdict = judge([file('slow', 70_000), file('fast', 1_000)], budget);
    expect(summarize(verdict, budget)).toMatch(/^### Desktop e2e time budget: 1 of 2 files over/u);
  });
});

describe('the budget file', () => {
  const real = JSON.parse(readFileSync(join(repoRoot, BUDGET_PATH), 'utf8'));

  it('is well formed, with its reason beside the number', () => {
    expect(budgetProblems(real)).toEqual([]);
  });

  it('waives only e2e files that exist', () => {
    for (const waived of Object.keys(real.waivers))
      expect(existsSync(join(repoRoot, DESKTOP, waived)), waived).toBe(true);
  });
});

describe('the command', () => {
  const run = (report) => {
    const folder = mkdtempSync(join(tmpdir(), 'e2e-budget-'));
    const reportPath = join(folder, 'durations.json');
    const summaryPath = join(folder, 'summary.md');
    writeFileSync(reportPath, typeof report === 'string' ? report : JSON.stringify(report));
    writeFileSync(summaryPath, '');
    try {
      const stdout = execFileSync(process.execPath, [script, reportPath], {
        cwd: repoRoot,
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
        encoding: 'utf8',
      });
      return { status: 0, stdout, summary: readFileSync(summaryPath, 'utf8') };
    } catch (error) {
      return {
        status: error.status,
        stdout: error.stdout,
        summary: readFileSync(summaryPath, 'utf8'),
      };
    }
  };

  it('exits 0 under the ceiling and writes the job summary', () => {
    const result = run([file('fast', 5_000)]);
    expect(result.status).toBe(0);
    expect(result.summary).toContain('0 of 1 files over');
  });

  it('exits 1 over the ceiling', () => {
    const result = run([file('slow', 70_000)]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('e2e/slow.desktop.test.ts took 70.0 s, ceiling 60.0 s');
  });

  it('exits 1 on a report that is not JSON', () => {
    const result = run('not json');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::e2e budget:');
  });
});
