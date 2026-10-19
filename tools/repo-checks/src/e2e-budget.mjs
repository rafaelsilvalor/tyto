#!/usr/bin/env node
/**
 * Holds every desktop e2e file to a time budget on CI (TYTO-310, ADR 0105).
 *
 * `test:desktop` grew from 143 s to 495 s in twelve days, about one suite per card, and nothing
 * noticed: a file that waits on a real window for two minutes looks the same in a green run as
 * one that takes two seconds. This check makes the growth visible and costs its author
 * something. It reads the per-file durations the `merge` job of `desktop-e2e.yml` writes
 * through `apps/desktop/e2e/durations-reporter.ts`, and fails when a file goes over the ceiling
 * in `e2e-budget.json`, naming the file and its seconds. Going over needs a waiver there, with
 * a reason and an owner card, not a bigger number.
 *
 * The durations are vitest's per-module durations, which include the file's `beforeAll` and
 * `afterAll` — where an e2e file launches and closes Electron. The JSON reporter's file times
 * leave the hooks out, so they would under-count exactly the cost this budget is about.
 *
 * Two columns are reported and never fail the run: seconds per test (a file of many quick tests
 * and a file of one slow test can weigh the same) and a waiver whose file is now under the
 * ceiling, which is stale and should be removed.
 *
 * Plain JavaScript and Node only, like `ci-scope.mjs`: the decision is `judge`, a pure function,
 * and the rest is reading files and writing the job summary.
 *
 *     node tools/repo-checks/src/e2e-budget.mjs apps/desktop/blob-reports/durations.json
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BUDGET_PATH = 'tools/repo-checks/src/e2e-budget.json';
/** The e2e files' folder, from the repository root; the report's paths are relative to the app. */
export const DESKTOP = 'apps/desktop';
/** How many of the slowest files the job summary lists; every offender is listed on top. */
export const TABLE_ROWS = 10;

/**
 * Checks the report's shape, so a reporter that wrote something else fails the run instead of
 * passing it with nothing measured.
 *
 * @param {unknown} report
 * @returns {string[]} what is wrong, empty when the report is usable
 */
export function reportProblems(report) {
  if (!Array.isArray(report)) return ['the report is not a list of files'];
  if (report.length === 0) return ['the report lists no files, so nothing was measured'];
  const problems = [];
  report.forEach((entry, index) => {
    const valid =
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.file === 'string' &&
      entry.file.length > 0 &&
      Number.isInteger(entry.tests) &&
      entry.tests >= 0 &&
      typeof entry.durationMs === 'number' &&
      Number.isFinite(entry.durationMs) &&
      entry.durationMs >= 0;
    if (!valid)
      problems.push(
        `entry ${index} is not { file: string, tests: integer, durationMs: number }: ${JSON.stringify(entry)}`,
      );
  });
  return problems;
}

/**
 * Checks the budget's shape: a ceiling, the reason for it, and waivers that each carry their
 * own ceiling, an owner card and a reason.
 *
 * @param {unknown} budget
 * @returns {string[]}
 */
export function budgetProblems(budget) {
  if (typeof budget !== 'object' || budget === null) return ['the budget is not an object'];
  const problems = [];
  if (!(typeof budget.ceilingMs === 'number' && budget.ceilingMs > 0))
    problems.push('`ceilingMs` is not a positive number');
  if (!(typeof budget.reason === 'string' && budget.reason.trim().length > 0))
    problems.push('`reason` is missing: the number needs its reason beside it');
  if (typeof budget.waivers !== 'object' || budget.waivers === null)
    return [...problems, '`waivers` is not an object'];
  for (const [file, waiver] of Object.entries(budget.waivers)) {
    if (typeof waiver !== 'object' || waiver === null) {
      problems.push(`the waiver for ${file} is not an object`);
      continue;
    }
    if (!(typeof waiver.ceilingMs === 'number' && waiver.ceilingMs > 0))
      problems.push(`the waiver for ${file} has no positive \`ceilingMs\``);
    if (!(typeof waiver.card === 'string' && /^TYTO-\d+$/u.test(waiver.card)))
      problems.push(`the waiver for ${file} has no owner \`card\` (TYTO-<n>)`);
    if (!(typeof waiver.reason === 'string' && waiver.reason.trim().length > 0))
      problems.push(`the waiver for ${file} has no \`reason\``);
  }
  return problems;
}

/**
 * The decision, with no I/O.
 *
 * @param {Array<{ file: string, tests: number, durationMs: number }>} report
 * @param {{ ceilingMs: number, waivers: Record<string, { ceilingMs: number, card: string }> }} budget
 */
export function judge(report, budget) {
  const problems = [...reportProblems(report), ...budgetProblems(budget)];
  if (problems.length > 0) return { problems, rows: [], offenders: [], staleWaivers: [] };

  const rows = report
    .map((entry) => {
      const waiver = budget.waivers[entry.file];
      const ceilingMs = waiver?.ceilingMs ?? budget.ceilingMs;
      return {
        file: entry.file,
        tests: entry.tests,
        durationMs: entry.durationMs,
        perTestMs: entry.tests > 0 ? entry.durationMs / entry.tests : entry.durationMs,
        ceilingMs,
        card: waiver?.card,
        over: entry.durationMs > ceilingMs,
        // A waiver whose file is back under the shared ceiling is not needed any more.
        staleWaiver: waiver !== undefined && entry.durationMs <= budget.ceilingMs,
      };
    })
    .sort((a, b) => b.durationMs - a.durationMs || a.file.localeCompare(b.file));

  return {
    problems: [],
    rows,
    offenders: rows.filter((row) => row.over),
    staleWaivers: rows.filter((row) => row.staleWaiver).map((row) => row.file),
  };
}

const seconds = (milliseconds) => (milliseconds / 1000).toFixed(1);

/**
 * The job summary: the slowest files and every offender, as a Markdown table.
 *
 * @param {ReturnType<typeof judge>} verdict
 * @param {{ ceilingMs: number }} budget
 */
export function summarize(verdict, budget) {
  if (verdict.problems.length > 0)
    return [
      '### Desktop e2e time budget: the report could not be judged',
      '',
      ...verdict.problems.map((problem) => `- ${problem}`),
      '',
    ].join('\n');

  const listed = verdict.rows.filter((row, index) => index < TABLE_ROWS || row.over);
  const total = verdict.rows.reduce((sum, row) => sum + row.durationMs, 0);
  const lines = [
    `### Desktop e2e time budget: ${verdict.offenders.length} of ${verdict.rows.length} files over`,
    '',
    `Ceiling ${seconds(budget.ceilingMs)} s per file (\`${BUDGET_PATH}\`). ` +
      `${verdict.rows.length} files, ${seconds(total)} s summed over the shards' workers; ` +
      `the ${listed.length} slowest below. Seconds per test is reported, never enforced.`,
    '',
    '| File | Tests | Seconds | Seconds per test | Ceiling | Waiver |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...listed.map(
      (row) =>
        `| ${row.over ? '**over** ' : ''}\`${row.file}\` | ${row.tests} | ${seconds(row.durationMs)} | ` +
        `${seconds(row.perTestMs)} | ${seconds(row.ceilingMs)} | ` +
        `${row.card === undefined ? '' : row.card + (row.staleWaiver ? ' (stale)' : '')} |`,
    ),
    '',
  ];
  if (verdict.staleWaivers.length > 0)
    lines.push(
      `Stale waivers, now under ${seconds(budget.ceilingMs)} s — remove them from the budget: ` +
        verdict.staleWaivers.map((file) => `\`${file}\``).join(', '),
      '',
    );
  return lines.join('\n');
}

/** One GitHub annotation per offender, on the file itself, and the problems as plain errors. */
export function annotations(verdict) {
  return [
    ...verdict.problems.map((problem) => `::error::e2e budget: ${problem}`),
    ...verdict.offenders.map(
      (row) =>
        `::error file=${DESKTOP}/${row.file}::${row.file} took ${seconds(row.durationMs)} s, ` +
        `ceiling ${seconds(row.ceilingMs)} s`,
    ),
    ...verdict.staleWaivers.map(
      (file) =>
        `::warning file=${DESKTOP}/${file}::${file} is under the ceiling; its waiver is stale`,
    ),
  ];
}

/** @returns {{ value: unknown } | { error: string }} */
function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { error: `${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function main() {
  const reportPath = process.argv[2];
  if (reportPath === undefined) {
    console.error('usage: e2e-budget.mjs <durations.json> [budget.json]');
    process.exitCode = 2;
    return;
  }
  const report = readJson(reportPath);
  const budget = readJson(process.argv[3] ?? BUDGET_PATH);
  const unreadable = [report, budget].filter((read) => 'error' in read).map((read) => read.error);
  const verdict =
    unreadable.length > 0
      ? { problems: unreadable, rows: [], offenders: [], staleWaivers: [] }
      : judge(report.value, budget.value);

  const summary = summarize(verdict, budget.value ?? {});
  console.log(summary);
  for (const line of annotations(verdict)) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (verdict.problems.length > 0 || verdict.offenders.length > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
