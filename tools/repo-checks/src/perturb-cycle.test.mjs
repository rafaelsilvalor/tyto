import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  backup,
  classifyCycle,
  cycle,
  describeEdit,
  gateFor,
  isInside,
  parseArguments,
  readVitestLog,
  restore,
  sha256,
} from './perturb-cycle.mjs';

const red = (text) => `${String.fromCharCode(27)}[31m${text}${String.fromCharCode(27)}[39m`;
const ORIGINAL = 'export const hours = (ms) => Math.floor(ms / 3600000);\n';
const PERTURBED = 'export const hours = (ms) => Math.round(ms / 3600000);\n';
const PASS_LOG = ' Test Files  1 passed (1)\n      Tests  22 passed (22)\n';
const FAIL_LOG = [
  ` ${red('FAIL')}  src/age.test.ts > hoursBetween > floors a partial hour`,
  'AssertionError: expected 2 to be 1 // Object.is equality',
  ` ${red('FAIL')}  src/age.test.ts > hoursBetween > floors a partial hour`,
  '      Tests  1 failed | 21 passed (22)',
].join('\n');

let root;
let repo;
let out;
let file;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'perturb-cycle-test-'));
  repo = path.join(root, 'repo');
  out = path.join(root, 'backup');
  file = path.join(repo, 'packages', 'recipe', 'src', 'age.ts');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, ORIGINAL);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const gitAt = (top) => (args) => {
  if (args.join(' ') !== 'rev-parse --show-toplevel') throw new Error(`unexpected git ${args}`);
  return `${top}\n`;
};

function printer() {
  const printed = [];
  return { printed, print: (line) => printed.push(line) };
}

/**
 * Answers only the commands it was given, writing each answer's log, and throws on any other.
 * An answer may be an Error, thrown as the run itself failing.
 */
function fakeRuns(answers) {
  const calls = [];
  const runLogged = async ({ command, args, cwd, logPath }) => {
    const key = [command === process.execPath ? 'node' : command, ...args].join(' ');
    calls.push({ key, cwd });
    if (!(key in answers)) throw new Error(`unexpected run: ${key}`);
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    const [code, log] = answer;
    writeFileSync(logPath, log);
    return code;
  };
  return { calls, runLogged };
}

const TYPECHECK = 'pnpm --filter @tyto/recipe typecheck';
const TEST = 'pnpm --filter @tyto/recipe exec vitest run src/age.test.ts';
const SUITE = 'pnpm --filter @tyto/recipe exec vitest run';

function backedUp(extra = {}) {
  const { print } = printer();
  const options = { out, file, packageName: '@tyto/recipe', test: 'src/age.test.ts', ...extra };
  expect(backup(options, { git: gitAt(repo), print })).toBe(0);
}

describe('backup', () => {
  it('copies the file outside the repository and records its hash', () => {
    const { printed, print } = printer();
    const options = { out, file, packageName: '@tyto/recipe', test: 'src/age.test.ts' };
    expect(backup(options, { git: gitAt(repo), print })).toBe(0);
    expect(readFileSync(path.join(out, 'original'), 'utf8')).toBe(ORIGINAL);
    const settings = JSON.parse(readFileSync(path.join(out, 'perturb.json'), 'utf8'));
    expect(settings).toMatchObject({ repo, file, gate: 'typecheck', sha256: sha256(ORIGINAL) });
    expect(printed).toEqual([
      `${sha256(ORIGINAL)}  ${file}`,
      `${sha256(ORIGINAL)}  ${path.join(out, 'original')}`,
      'backup: hashes equal',
      'gate: the package typecheck',
    ]);
  });

  it('refuses a folder inside the repository, and a backup that differs from the file', () => {
    const { printed, print } = printer();
    const inside = { out: path.join(repo, 'tmp'), file, packageName: 'p', test: 't' };
    expect(backup(inside, { git: gitAt(repo), print })).toBe(2);
    backedUp();
    writeFileSync(file, PERTURBED);
    const again = { out, file, packageName: 'p', test: 't' };
    expect(backup(again, { git: gitAt(repo), print })).toBe(2);
    expect(readFileSync(path.join(out, 'original'), 'utf8')).toBe(ORIGINAL);
    expect(printed[0]).toMatch(/^refused: the backup folder .* is inside the repository/u);
    expect(printed[1]).toMatch(/^refused: .*original exists and differs from/u);
  });
});

describe('cycle', () => {
  it('runs a caught perturbation, names who caught it, and restores with the proof', async () => {
    backedUp();
    writeFileSync(file, PERTURBED);
    const { calls, runLogged } = fakeRuns({
      [TYPECHECK]: [0, '> tsc --noEmit\n'],
      [TEST]: [1, FAIL_LOG],
      [SUITE]: [1, FAIL_LOG],
    });
    const { printed, print } = printer();
    expect(await cycle({ out }, { runLogged, platform: 'linux', print })).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(ORIGINAL);
    expect(calls.map(({ key }) => key)).toEqual([TYPECHECK, TEST, SUITE]);
    expect(calls.every(({ cwd }) => cwd === repo)).toBe(true);
    expect(printed.slice(0, 3)).toEqual([
      '@@ line 1 @@',
      '- export const hours = (ms) => Math.floor(ms / 3600000);',
      '+ export const hours = (ms) => Math.round(ms / 3600000);',
    ]);
    expect(printed).toContain('verdict: caught');
    expect(printed).toContain('restore: cmp equal');
    expect(printed).toContain(`${sha256(ORIGINAL)}  ${file}`);
    expect(printed).toContain('restore: same hash as before the first edit');
    expect(printed.at(-1)).toBe(
      '| age.ts line 1: `export const hours = (ms) => Math.floor(ms / 3600000);` → `export const hours = (ms) => Math.round(ms / 3600000);` | exit 0 | src/age.test.ts > hoursBetween > floors a partial hour (test file, package suite): AssertionError: expected 2 to be 1 // Object.is equality | caught |',
    );
  });

  it('restores after a typecheck failure, and runs no test', async () => {
    backedUp();
    writeFileSync(file, PERTURBED);
    const typeError = "src/age.ts(1,30): error TS2304: Cannot find name 'Math2'.\n";
    const { calls, runLogged } = fakeRuns({ [TYPECHECK]: [2, typeError] });
    const { printed, print } = printer();
    expect(await cycle({ out }, { runLogged, platform: 'linux', print })).toBe(0);
    expect(calls.map(({ key }) => key)).toEqual([TYPECHECK]);
    expect(readFileSync(file, 'utf8')).toBe(ORIGINAL);
    expect(printed).toContain('does not compile: discarded, not run');
    expect(printed).toContain('restore: cmp equal');
    expect(printed.at(-1)).toMatch(
      /\| src\/age\.ts\(1,30\): error TS2304: [^|]+ \| {2}\| discarded \|$/u,
    );
  });

  it('restores when the test run throws, and lets the error through', async () => {
    backedUp();
    writeFileSync(file, PERTURBED);
    const { runLogged } = fakeRuns({
      [TYPECHECK]: [0, ''],
      [TEST]: new Error('spawn pnpm ENOENT'),
    });
    const { printed, print } = printer();
    await expect(cycle({ out }, { runLogged, platform: 'linux', print })).rejects.toThrow(
      'spawn pnpm ENOENT',
    );
    expect(readFileSync(file, 'utf8')).toBe(ORIGINAL);
    expect(printed).toContain('restore: cmp equal');
  });

  it('rebuilds with the perturbation and again after the restore, and runs the consumers', async () => {
    backedUp({ rebuild: '@tyto/core', consumers: ['@tyto/pipeline'] });
    writeFileSync(file, PERTURBED);
    const build = 'pnpm --filter @tyto/core build';
    const consumer = 'pnpm --filter @tyto/pipeline exec vitest run';
    const { calls, runLogged } = fakeRuns({
      [TYPECHECK]: [0, ''],
      [build]: [0, ''],
      [TEST]: [0, PASS_LOG],
      [SUITE]: [0, PASS_LOG],
      [consumer]: [1, FAIL_LOG],
    });
    const { printed, print } = printer();
    expect(await cycle({ out }, { runLogged, platform: 'linux', print })).toBe(0);
    expect(calls.map(({ key }) => key)).toEqual([TYPECHECK, build, TEST, SUITE, consumer, build]);
    expect(printed).toContain('rebuilt @tyto/core with the perturbation, exit 0');
    expect(printed.indexOf('rebuilt @tyto/core after the restore, exit 0')).toBeGreaterThan(
      printed.indexOf('restore: cmp equal'),
    );
    expect(printed).toContain('verdict: caught');
  });

  it('starts pnpm through a shell on Windows', async () => {
    backedUp();
    writeFileSync(file, PERTURBED);
    const requests = [];
    const runLogged = async (request) => {
      requests.push(request);
      writeFileSync(request.logPath, PASS_LOG);
      return 0;
    };
    const { print } = printer();
    await cycle({ out }, { runLogged, platform: 'win32', print });
    expect(requests[0]).toMatchObject({ command: TYPECHECK, args: [], shell: true });
  });

  it('runs nothing when the file still equals its backup', async () => {
    backedUp();
    const { calls, runLogged } = fakeRuns({});
    const { printed, print } = printer();
    expect(await cycle({ out }, { runLogged, platform: 'linux', print })).toBe(2);
    expect(calls).toEqual([]);
    expect(printed).toEqual([`no perturbation: ${file} equals its backup; apply the edit first`]);
  });

  it('gates a file no tsconfig includes with node --check', async () => {
    const script = path.join(repo, 'tools', 'x.mjs');
    mkdirSync(path.dirname(script), { recursive: true });
    writeFileSync(script, 'export const a = 1;\n');
    const { print } = printer();
    const options = { out, file: script, packageName: '@tyto/x', test: 'src/x.test.mjs' };
    expect(backup(options, { git: gitAt(repo), print })).toBe(0);
    writeFileSync(script, 'export const a = ;\n');
    const check = `node --check ${script}`;
    const syntax = "SyntaxError: Unexpected token ';'\n";
    const { calls, runLogged } = fakeRuns({ [check]: [1, syntax] });
    const { printed } = printer();
    const io = { runLogged, platform: 'linux', print: (line) => printed.push(line) };
    expect(await cycle({ out }, io)).toBe(0);
    expect(calls.map(({ key }) => key)).toEqual([check]);
    expect(printed).toContain('does not compile: discarded, not run');
    expect(readFileSync(script, 'utf8')).toBe('export const a = 1;\n');
  });

  it('fails when the restore is not proved', async () => {
    backedUp();
    writeFileSync(file, PERTURBED);
    const { runLogged } = fakeRuns({
      [TYPECHECK]: [0, ''],
      [TEST]: [0, PASS_LOG],
      [SUITE]: [0, PASS_LOG],
    });
    const { printed, print } = printer();
    const copy = () => {};
    expect(await cycle({ out }, { runLogged, copy, platform: 'linux', print })).toBe(1);
    expect(printed).toContain(`RESTORE FAILED: ${file} differs from ${path.join(out, 'original')}`);
  });
});

describe('restore', () => {
  it('is idempotent, with the proof each time, and rebuilds when asked', async () => {
    backedUp({ rebuild: '@tyto/core' });
    writeFileSync(file, PERTURBED);
    const build = 'pnpm --filter @tyto/core build';
    const { calls, runLogged } = fakeRuns({ [build]: [0, ''] });
    const { printed, print } = printer();
    const io = { runLogged, platform: 'linux', print };
    expect(await restore({ out }, io)).toBe(0);
    expect(await restore({ out }, io)).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(ORIGINAL);
    expect(calls.map(({ key }) => key)).toEqual([build, build]);
    expect(printed.filter((line) => line === 'restore: cmp equal')).toHaveLength(2);
  });
});

describe('who caught it', () => {
  it('reads the Tests line and each failed test once, with its first error line', () => {
    expect(readVitestLog(FAIL_LOG)).toEqual({
      summary: 'Tests  1 failed | 21 passed (22)',
      failures: [
        {
          test: 'src/age.test.ts > hoursBetween > floors a partial hour',
          error: 'AssertionError: expected 2 to be 1 // Object.is equality',
        },
      ],
    });
  });

  it('calls all-green runs a gap, and a failed run with no test named unclear', () => {
    const pass = { code: 0, text: PASS_LOG };
    expect(classifyCycle([{ where: 'test file', ...pass }])).toEqual({ verdict: 'gap', who: '' });
    expect(
      classifyCycle([{ where: 'package suite', code: 1, text: 'Error: no config\n' }]),
    ).toEqual({
      verdict: 'unclear',
      who: 'package suite exit 1 with no failed test named',
    });
    const caught = classifyCycle([
      { where: 'test file', ...pass },
      { where: 'package suite', code: 1, text: FAIL_LOG },
    ]);
    expect(caught.verdict).toBe('caught');
    expect(caught.who).toMatch(
      /^src\/age\.test\.ts > hoursBetween > floors a partial hour \(package suite\): /u,
    );
  });
});

describe('helpers', () => {
  it('describes a one-line edit as one hunk, and no edit as nothing', () => {
    expect(describeEdit('a\nb > 59\nc\n', 'a\nb > 60\nc\n')).toEqual([
      '@@ line 2 @@',
      '- b > 59',
      '+ b > 60',
    ]);
    expect(describeEdit('a\r\nb\r\n', 'a\nb\n')).toEqual([]);
  });

  it('tells a folder inside the repository on either platform, ignoring case', () => {
    expect(isInside('C:\\Repo\\tmp', 'c:/repo')).toBe(true);
    expect(isInside('C:\\Repo-backup', 'C:\\Repo')).toBe(false);
    expect([gateFor('src/age.ts'), gateFor('src/x.mjs')]).toEqual(['typecheck', 'node --check']);
  });

  it('reads a call and says what is wrong with one', () => {
    const parse = (line) => parseArguments(line === '' ? [] : line.split(' '));
    expect(parse('cycle --out /b')).toEqual({ mode: 'cycle', flags: { out: '/b' } });
    const errors = {
      '': 'unknown mode: (none)',
      'cycle --out /b --file x': 'cycle takes no --file',
      'backup --out /b': 'missing --file --package --test',
      'restore --out': '--out needs a value',
      'restore /b': 'unexpected argument: /b',
    };
    for (const [line, error] of Object.entries(errors)) expect(parse(line).error, line).toBe(error);
  });
});
