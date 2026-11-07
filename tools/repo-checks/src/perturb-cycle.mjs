#!/usr/bin/env node
/**
 * The backup, cycle and restore of `/perturb` (TYTO-629). It replaces the `cycle.sh` that
 * `/perturb` step 3 had an agent write by hand with five edited constants (and its Codex port),
 * which nobody tested and the worktree isolation guard refused to run. `USAGE` below lists the
 * three modes.
 *
 * `backup` copies the mechanism's file to `<out>/original` and writes `<out>/perturb.json`: the
 * file, the package and test that guard it, the gate, the optional rebuild, and the original's
 * sha256. `cycle` and `restore` read everything back from there, so a call is one line.
 *
 * `cycle` runs one perturbation that is already on disk: it prints the edit, runs the gate (the
 * package typecheck, or `node --check` for a file no tsconfig includes), rebuilds when asked,
 * runs the test file, the package suite and the consumers, and says who caught it. **The
 * restore runs whatever happens**: in a `finally` block, and from the SIGINT and SIGTERM
 * handlers. Only a kill that cannot be handled, such as a tool timeout that kills the process
 * tree, skips it; `restore` is then the next command, and it is idempotent.
 *
 * The restore copies the backup over the file and proves it twice, byte for byte and by hash
 * against the hash recorded before the first edit. It never asks git: the file may carry edits
 * nobody committed.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { git as defaultGit, parseFlags } from './command-runner.mjs';
import { pnpmInvocation, runLogged as defaultRunLogged, stripAnsi } from './flake-hunt.mjs';

/**
 * @typedef {import('./command-runner.mjs').Runner} Runner
 * @typedef {import('./flake-hunt.mjs').LoggedRequest} LoggedRequest
 * @typedef {{
 *   repo: string, file: string, packageName: string, test: string, rebuild: string,
 *   consumers: string[], gate: 'typecheck' | 'node --check', sha256: string,
 * }} Settings
 * @typedef {{
 *   git?: Runner, runLogged?: (request: LoggedRequest) => Promise<number>,
 *   copy?: (from: string, to: string) => void, platform?: string, print?: (line: string) => void,
 * }} Io
 */

export const SETTINGS_FILE = 'perturb.json';
export const ORIGINAL_FILE = 'original';

/** @param {Io} io */
function withDefaults(io) {
  return {
    git: io.git ?? defaultGit,
    runLogged: io.runLogged ?? defaultRunLogged,
    copy: io.copy ?? ((from, to) => fs.copyFileSync(from, to)),
    platform: io.platform ?? process.platform,
    print: io.print ?? console.log,
  };
}

/** @param {Buffer | string} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * A file no tsconfig includes is not typechecked: `node --check` is the gate there, and it
 * only proves the file parses.
 *
 * @param {string} file
 * @returns {Settings['gate']}
 */
export const gateFor = (file) => (/\.[cm]?tsx?$/u.test(file) ? 'typecheck' : 'node --check');

/**
 * Whether the absolute path `inner` is `outer` or lies under it, on either platform's paths.
 * Letter case is ignored, which on a case-sensitive disk only refuses more.
 *
 * @param {string} inner
 * @param {string} outer
 */
export function isInside(inner, outer) {
  const normal = (/** @type {string} */ value) =>
    value.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase();
  const [child, parent] = [normal(inner), normal(outer)];
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * The edit as one hunk: the lines between the longest common head and tail, numbered from the
 * original. A perturbation is a small edit, so one hunk reads like `diff`.
 *
 * @param {string} before
 * @param {string} after
 * @returns {string[]}
 */
export function describeEdit(before, after) {
  const old = before.split(/\r?\n/u);
  const next = after.split(/\r?\n/u);
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head]) head += 1;
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1;
  }
  const removed = old.slice(head, old.length - tail);
  const added = next.slice(head, next.length - tail);
  if (removed.length === 0 && added.length === 0) return [];
  return [
    `@@ line ${head + 1} @@`,
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
  ];
}

/**
 * What one vitest log says: its `Tests` summary line and each failed test (the `FAIL` line,
 * once, with the first error line under it).
 *
 * @param {string} text
 */
export function readVitestLog(text) {
  const lines = stripAnsi(text).split(/\r?\n/u);
  const summary = lines.find((line) => /Tests +\d+ (failed|passed)/u.test(line))?.trim() ?? '';
  /** @type {{ test: string, error: string }[]} */
  const failures = [];
  lines.forEach((line, index) => {
    const match = /\bFAIL\s+(.+?)\s*$/u.exec(line);
    if (match === null || match[1] === undefined) return;
    const test = match[1];
    if (failures.some((failure) => failure.test === test)) return;
    const error =
      lines
        .slice(index + 1, index + 12)
        .find((next) => /Error|expected/u.test(next) && !/\bFAIL\b/u.test(next))
        ?.trim() ?? '';
    failures.push({ test, error });
  });
  return { summary, failures };
}

/**
 * The verdict of one cycle from its runs: **caught** when a test failed, **gap** when every run
 * passed, **unclear** when a run failed with no failing test to name (it did not run, or
 * crashed), which a person reads in the log.
 *
 * @param {{ where: string, code: number, text: string }[]} runs
 */
export function classifyCycle(runs) {
  /** @type {Map<string, { error: string, where: string[] }>} */
  const caught = new Map();
  for (const { where, code, text } of runs) {
    const { failures } = readVitestLog(text);
    for (const { test, error } of failures) {
      const known = caught.get(test) ?? { error, where: [] };
      known.where.push(where);
      caught.set(test, known);
    }
    if (code !== 0 && failures.length === 0) {
      return { verdict: 'unclear', who: `${where} exit ${code} with no failed test named` };
    }
  }
  if (caught.size === 0) return { verdict: 'gap', who: '' };
  const who = [...caught].map(
    ([test, { error, where }]) => `${test} (${where.join(', ')}): ${error}`,
  );
  return { verdict: 'caught', who: who.join('; ') };
}

/** @param {string} out */
export const readSettings = (out) =>
  /** @type {Settings} */ (JSON.parse(fs.readFileSync(path.join(out, SETTINGS_FILE), 'utf8')));

/**
 * Copies the mechanism's file to `<out>/original` and records the settings with its hash. It
 * refuses a backup folder inside the repository, and a backup that differs from the file: that
 * backup may be the only copy of the original while a perturbation is on disk.
 *
 * @param {{ out: string, file: string, packageName: string, test: string, rebuild?: string, consumers?: string[], cwd?: string }} options
 * @param {Io} [io]
 */
export function backup(options, io = {}) {
  const { git, copy, print } = withDefaults(io);
  const cwd = options.cwd ?? process.cwd();
  const repo = path.resolve(git(['rev-parse', '--show-toplevel'], { cwd }).trim());
  const out = path.resolve(options.out);
  const file = path.resolve(cwd, options.file);
  if (isInside(out, repo)) {
    print(`refused: the backup folder ${out} is inside the repository ${repo}`);
    return 2;
  }
  if (!fs.existsSync(file)) {
    print(`refused: no file at ${file}`);
    return 2;
  }
  const original = path.join(out, ORIGINAL_FILE);
  const hash = sha256(fs.readFileSync(file));
  if (fs.existsSync(original) && sha256(fs.readFileSync(original)) !== hash) {
    print(`refused: ${original} exists and differs from ${file}`);
    print(`restore it first (restore --out ${out}), or choose another folder`);
    return 2;
  }
  fs.mkdirSync(out, { recursive: true });
  copy(file, original);
  /** @type {Settings} */
  const settings = {
    repo,
    file,
    packageName: options.packageName,
    test: options.test,
    rebuild: options.rebuild ?? '',
    consumers: options.consumers ?? [],
    gate: gateFor(file),
    sha256: hash,
  };
  fs.writeFileSync(path.join(out, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
  const copied = sha256(fs.readFileSync(original));
  print(`${hash}  ${file}`);
  print(`${copied}  ${original}`);
  print(copied === hash ? 'backup: hashes equal' : 'BACKUP FAILED: the hashes differ');
  print(`gate: ${describeGate(settings.gate)}`);
  return copied === hash ? 0 : 1;
}

/** @param {Settings['gate']} gate */
const describeGate = (gate) =>
  gate === 'typecheck'
    ? 'the package typecheck'
    : 'node --check (weaker: the file is not typechecked, only parsed)';

/**
 * Copies the backup over the file and proves it: byte for byte, and by hash against the one
 * recorded before the first edit. Synchronous, so a signal handler can run it whole.
 *
 * @param {string} out
 * @param {Settings} settings
 * @param {ReturnType<typeof withDefaults>} io
 */
function restoreFile(out, settings, { copy, print }) {
  const original = path.join(out, ORIGINAL_FILE);
  copy(original, settings.file);
  const equal = fs.readFileSync(original).equals(fs.readFileSync(settings.file));
  const hash = sha256(fs.readFileSync(settings.file));
  const same = hash === settings.sha256;
  print(equal ? 'restore: cmp equal' : `RESTORE FAILED: ${settings.file} differs from ${original}`);
  print(`${hash}  ${settings.file}`);
  print(
    same
      ? 'restore: same hash as before the first edit'
      : `RESTORE FAILED: hash ${hash} is not ${settings.sha256}`,
  );
  return equal && same;
}

/**
 * Builds the package the other tests read through its `dist`.
 *
 * @param {Settings} settings
 * @param {string} out
 * @param {ReturnType<typeof withDefaults>} io
 * @param {string} when
 */
async function rebuild(settings, out, io, when) {
  if (settings.rebuild === '') return;
  const invocation = pnpmInvocation(['--filter', settings.rebuild, 'build'], io.platform);
  const logPath = path.join(out, 'rebuild.log');
  const code = await io.runLogged({ ...invocation, cwd: settings.repo, logPath });
  io.print(`rebuilt ${settings.rebuild} ${when}, exit ${code}`);
}

/**
 * Only the restore: idempotent, with the same proof as a cycle's, and the rebuild after it.
 *
 * @param {{ out: string }} options
 * @param {Io} [io]
 */
export async function restore({ out }, io = {}) {
  const resolved = withDefaults(io);
  const settings = readSettings(out);
  const restored = restoreFile(out, settings, resolved);
  await rebuild(settings, out, resolved, 'after the restore');
  return restored ? 0 : 1;
}

/**
 * Runs one command into `<out>/<name>.log`, printing its exit code.
 *
 * @param {string[]} args
 * @param {string} name
 * @param {string} out
 * @param {Settings} settings
 * @param {ReturnType<typeof withDefaults>} io
 */
async function runInto(args, name, out, settings, io) {
  const logPath = path.join(out, `${name}.log`);
  fs.rmSync(logPath, { force: true });
  const invocation =
    args[0] === 'node'
      ? { command: process.execPath, args: args.slice(1), shell: false }
      : pnpmInvocation(args, io.platform);
  const code = await io.runLogged({ ...invocation, cwd: settings.repo, logPath });
  const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  return { code, text };
}

/**
 * One perturbation, already on disk: the edit, the gate, the runs and who caught it, then the
 * restore whatever happened. Exit code 1 when the restore is not proved, 2 when there was no
 * perturbation to run.
 *
 * @param {{ out: string }} options
 * @param {Io} [io]
 */
export async function cycle({ out }, io = {}) {
  const resolved = withDefaults(io);
  const { print } = resolved;
  const settings = readSettings(out);
  const original = fs.readFileSync(path.join(out, ORIGINAL_FILE), 'utf8');
  const edit = describeEdit(original, fs.readFileSync(settings.file, 'utf8'));
  if (edit.length === 0) {
    print(`no perturbation: ${settings.file} equals its backup; apply the edit first`);
    return 2;
  }
  let restored;
  /** @type {{ verdict: string, who: string, gate: string }} */
  let row;
  try {
    for (const line of edit) print(line);
    row = await runCycle(settings, out, resolved);
  } finally {
    restored = restoreFile(out, settings, resolved);
    await rebuild(settings, out, resolved, 'after the restore');
  }
  print('');
  print('| Perturbation | Typecheck | Who caught it | Verdict |');
  print('| ------------ | --------- | ------------- | ------- |');
  print(
    `| ${describeRowEdit(settings.file, edit)} | ${cell(row.gate)} | ${cell(row.who)} | ${row.verdict} |`,
  );
  return restored ? 0 : 1;
}

/** @param {string} text */
const cell = (text) => text.replace(/\|/gu, '\\|');

/**
 * The edit as a table cell: the file and line, then the old lines and the new ones.
 *
 * @param {string} file
 * @param {string[]} edit
 */
export function describeRowEdit(file, edit) {
  const side = (/** @type {string} */ sign) =>
    edit
      .filter((line) => line.startsWith(sign))
      .map((line) => `\`${cell(line.slice(2).trim())}\``)
      .join(' ') || '(nothing)';
  const line = edit[0]?.replace(/@/gu, '').trim() ?? '';
  return `${path.basename(file)} ${line}: ${side('- ')} → ${side('+ ')}`;
}

/**
 * @param {Settings} settings
 * @param {string} out
 * @param {ReturnType<typeof withDefaults>} io
 */
async function runCycle(settings, out, io) {
  const { print } = io;
  const gateArgs =
    settings.gate === 'typecheck'
      ? ['--filter', settings.packageName, 'typecheck']
      : ['node', '--check', settings.file];
  const gate = await runInto(gateArgs, 'typecheck', out, settings, io);
  print(`${settings.gate} exit ${gate.code}`);
  const errors = stripAnsi(gate.text)
    .split(/\r?\n/u)
    .filter((line) =>
      settings.gate === 'typecheck' ? /error TS/u.test(line) : /Error/u.test(line),
    );
  if (errors.length > 0 || (settings.gate === 'node --check' && gate.code !== 0)) {
    for (const line of errors.slice(0, 3)) print(line.trim());
    print('does not compile: discarded, not run');
    return { verdict: 'discarded', who: '', gate: errors[0]?.trim() ?? `exit ${gate.code}` };
  }
  await rebuild(settings, out, io, 'with the perturbation');

  const vitest = (/** @type {string} */ packageName, /** @type {string[]} */ files) => [
    ...['--filter', packageName, 'exec', 'vitest', 'run'],
    ...files,
  ];
  const runs = [];
  const testFile = await runInto(
    vitest(settings.packageName, [settings.test]),
    'test',
    out,
    settings,
    io,
  );
  print(`test file exit ${testFile.code}`);
  runs.push({ where: 'test file', ...testFile });
  const suite = await runInto(vitest(settings.packageName, []), 'suite', out, settings, io);
  print(`package suite exit ${suite.code}`);
  runs.push({ where: 'package suite', ...suite });
  for (const consumer of settings.consumers) {
    const name = `consumer-${consumer.replace(/[^\w-]/gu, '_')}`;
    const run = await runInto(vitest(consumer, []), name, out, settings, io);
    print(`${consumer} suite exit ${run.code}`);
    runs.push({ where: `${consumer} suite`, ...run });
  }
  for (const { where, text } of runs) {
    const { summary, failures } = readVitestLog(text);
    print(`${where}: ${summary || 'no Tests line'}`);
    for (const { test, error } of failures) print(`  FAIL ${test}: ${error}`);
  }
  const { verdict, who } = classifyCycle(runs);
  print(`verdict: ${verdict}`);
  return { verdict, who, gate: `exit ${gate.code}` };
}

const USAGE = `usage:
  perturb-cycle.mjs backup --out <backup folder> --file <mechanism file> --package <name> --test <test file in the package> [--rebuild <name>] [--consumers <name,name>]
  perturb-cycle.mjs cycle --out <backup folder>
  perturb-cycle.mjs restore --out <backup folder>`;

const FLAGS = {
  backup: ['out', 'file', 'package', 'test', 'rebuild', 'consumers'],
  cycle: ['out'],
  restore: ['out'],
};

/**
 * Reads the mode and the flags, and says what is wrong with them.
 *
 * @param {string[]} argv
 * @returns {{ mode: string, flags: Record<string, string> } | { error: string }}
 */
export function parseArguments(argv) {
  const [mode = '', ...rest] = argv;
  if (!Object.hasOwn(FLAGS, mode)) return { error: `unknown mode: ${mode || '(none)'}` };
  const allowed = FLAGS[/** @type {keyof typeof FLAGS} */ (mode)];
  /** @type {Record<string, string>} */
  const flags = {};
  try {
    for (const [name, value] of Object.entries(parseFlags(rest))) {
      if (!allowed.includes(name)) return { error: `${mode} takes no --${name}` };
      if (value === true) return { error: `--${name} needs a value` };
      flags[name] = value;
    }
  } catch (error) {
    return { error: /** @type {Error} */ (error).message };
  }
  const required = mode === 'backup' ? ['out', 'file', 'package', 'test'] : ['out'];
  const missing = required.filter((name) => flags[name] === undefined);
  if (missing.length > 0) return { error: `missing --${missing.join(' --')}` };
  return { mode, flags };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`${parsed.error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const { mode, flags } = parsed;
  const out = path.resolve(flags.out ?? '.');
  if (mode === 'backup') {
    process.exitCode = backup({
      out,
      file: flags.file ?? '',
      packageName: flags.package ?? '',
      test: flags.test ?? '',
      rebuild: flags.rebuild ?? '',
      consumers: (flags.consumers ?? '').split(',').filter((name) => name !== ''),
    });
  } else if (mode === 'restore') process.exitCode = await restore({ out });
  else {
    // An interrupt restores before it exits; the rebuild is left to `restore`.
    const interrupt = () => {
      const settings = readSettings(out);
      restoreFile(out, settings, withDefaults({}));
      if (settings.rebuild !== '') console.log(`interrupted: run restore --out ${out} to rebuild`);
      process.exit(143);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    process.exitCode = await cycle({ out });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
