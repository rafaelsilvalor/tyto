#!/usr/bin/env node
/**
 * The arms of a timing-flake hunt (TYTO-629). It replaces the arm script `/flake-hunt` step 3
 * had an agent write by hand, and the comparison loop of step 6 (and their Codex ports), which
 * nobody tested. `USAGE` below lists the four modes.
 *
 * `arm` runs the test `--runs` times in `--cwd` with `pnpm --filter <package> exec vitest`,
 * beside the load, and writes everything under `<out>/<arm>/`: `arm.json` (the settings that
 * `classify` and `compare` read back), `load.json` (the load's tag and PIDs), one
 * `run-<i>.log` per run, `exits.txt` and `classes.txt`.
 *
 * Every load process carries a tag in its command line: the CPU burners as an extra argument,
 * the storm's app instances in their `--user-data-dir`, which Chromium passes on to every
 * child process. `stop` kills only the processes whose command line holds the tag, never every
 * `node` or `electron`: other sessions run tests on the same machine. It is idempotent, and it
 * is the cleanup that always runs, since a tool timeout that kills `arm` skips its own.
 *
 * Processes are listed through a port: `Get-CimInstance Win32_Process` on Windows, `pgrep -af`
 * elsewhere. Load processes are started with Node's `spawn`, so their PIDs are the real ones
 * (in Git Bash, `$!` of a backgrounded `node` is a `bash.exe` wrapper).
 */
import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { git as defaultGit, parseFlags } from './command-runner.mjs';

export const LOADS = ['none', 'cpu', 'storm'];
export const CLASSES = ['pass', 'flake', 'launch', 'worker', 'other'];
/** The storm starts this many app instances, and kills them this long after. */
export const STORM_INSTANCES = 3;
export const STORM_ROUND_MS = 8000;

/**
 * @typedef {import('./command-runner.mjs').Runner} Runner
 * @typedef {{ pid: number, name: string, commandLine: string }} Process
 * @typedef {{ list: () => Process[], kill: (pid: number) => void }} ProcessTable
 * @typedef {(command: string, args: string[]) => string} Exec
 * @typedef {{ free: number, total: number }} Memory
 * @typedef {{ arm: string, tree: string, sha: string, load: string, packageName: string, file: string, test: string, sig: string, config: string, runs: number, stormApp: string, memory: Memory }} ArmSettings
 */

// eslint-disable-next-line no-control-regex -- the escape character starts vitest's colours
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/gu;

/** @param {string} text */
export const stripAnsi = (text) => text.replace(ANSI, '');

/**
 * One run's class, in this order: `pass` (exit 0, with vitest's `Tests` line, so a run that
 * ran nothing shows), `flake` (this test's failure: `sig`, or an `AssertionError` when `sig` is
 * empty), `launch` (the app never opened a window, or a hook timed out before any test
 * passed), `worker` (vitest could not start a worker: machine load), `other`. Only `flake`
 * counts as the flake.
 *
 * @param {{ code: number | undefined, text: string, sig?: string }} run
 */
export function classifyLog({ code, text, sig = '' }) {
  const logLines = stripAnsi(text).split(/\r?\n/u);
  /** @param {RegExp | string} test */
  const find = (test) =>
    logLines.find((line) => (typeof test === 'string' ? line.includes(test) : test.test(line)));
  /** @param {string} name @param {string | undefined} line */
  const result = (name, line) => ({ class: name, line: (line ?? '').trimStart() });

  if (code === 0) return result('pass', find(/Tests +[0-9]+/u));
  const failure = find(sig === '' ? 'AssertionError' : sig);
  if (failure !== undefined) return result('flake', failure);
  const hookBeforeAnyPass = find('Hook timed out') !== undefined && find(/✓|√/u) === undefined;
  if (find(/firstWindow|Process failed to launch/u) !== undefined || hookBeforeAnyPass) {
    return result('launch', find(/firstWindow|Process failed to launch|Hook timed out/u));
  }
  const worker = find(/Timeout waiting for worker|Failed to start .*worker/u);
  if (worker !== undefined) return result('worker', worker);
  return result('other', find(/Error|FAIL/u));
}

/**
 * The exit code of each run, from the `run <i> exit <code>` lines of `exits.txt`.
 *
 * @param {string} text
 */
export function parseExits(text) {
  const matches = text.matchAll(/^run (\d+) exit (\d+)\r?$/gmu);
  return new Map([...matches].map((match) => [Number(match[1]), Number(match[2])]));
}

/** @param {Memory} memory */
export function describeMemory({ free, total }) {
  const gigabytes = (/** @type {number} */ bytes) => (bytes / 1024 ** 3).toFixed(1);
  return `${gigabytes(free)} GB free of ${gigabytes(total)} GB`;
}

/**
 * The chance that a tree with the control's defect shows no flake in `runs` runs, when the
 * control went red `red` times in as many: (1 − red/runs)^runs.
 *
 * @param {number} red
 * @param {number} runs
 */
export const luck = (red, runs) => (1 - red / runs) ** runs;

/** @param {number} fraction */
export function formatPercent(fraction) {
  const percent = fraction * 100;
  return percent >= 10 ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%`;
}

/** Every process with its id, name and command line, as one JSON document. */
export const WINDOWS_PROCESS_LIST =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';

/**
 * PowerShell prints one process as an object and several as an array.
 *
 * @param {string} output
 * @returns {Process[]}
 */
export function parseWindowsProcesses(output) {
  if (output.trim() === '') return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
    pid: Number(entry.ProcessId),
    name: String(entry.Name ?? ''),
    commandLine: String(entry.CommandLine ?? ''),
  }));
}

/**
 * `pgrep -af` prints `<pid> <command line>`; the name is the first word's base name.
 *
 * @param {string} output
 * @returns {Process[]}
 */
export function parsePosixProcesses(output) {
  return [...output.matchAll(/^\s*(\d+)\s+(.*?)\r?$/gmu)].map((match) => {
    const commandLine = match[2] ?? '';
    const name = path.posix.basename(commandLine.split(/\s+/u)[0] ?? '');
    return { pid: Number(match[1]), name, commandLine };
  });
}

/** @type {Exec} */
const execProcess = (command, args) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

/**
 * The machine's process table, through the platform's own tools. Killing a process that is
 * already gone is not an error.
 *
 * @param {{ platform?: string, exec?: Exec }} [options]
 * @returns {ProcessTable}
 */
export function processTable({ platform = process.platform, exec = execProcess } = {}) {
  const windows = platform === 'win32';
  return {
    list: () => {
      if (windows) {
        return parseWindowsProcesses(
          exec('powershell', ['-NoProfile', '-Command', WINDOWS_PROCESS_LIST]),
        );
      }
      try {
        return parsePosixProcesses(exec('pgrep', ['-af', '.']));
      } catch (error) {
        // pgrep exits 1 when nothing matches.
        if (/** @type {{ status?: number }} */ (error).status === 1) return [];
        throw error;
      }
    },
    kill: (pid) => {
      try {
        if (windows) exec('taskkill', ['/PID', String(pid), '/F']);
        else exec('kill', ['-KILL', String(pid)]);
      } catch {
        // Already gone.
      }
    },
  };
}

/** @param {Process[]} processes @param {string} tag */
export const carrying = (processes, tag) =>
  processes.filter(({ commandLine }) => commandLine.includes(tag));

/** @param {Process[]} processes */
export const countNodeAndElectron = (processes) =>
  processes.filter(({ name }) => /^(node|electron)(\.exe)?$/iu.test(name)).length;

/** @param {{ name: string, pid: number }[]} processes */
const describeProcesses = (processes) => processes.map(({ name, pid }) => `${name} ${pid}`);

/**
 * One argument as cmd.exe reads it: bare when it holds only safe characters, otherwise in
 * double quotes with inner quotes doubled.
 *
 * @param {string} argument
 */
export const quoteForCmd = (argument) =>
  /^[\w@./:=+,-]+$/u.test(argument) ? argument : `"${argument.replace(/"/gu, '""')}"`;

/**
 * How to start `pnpm`. On Windows it is `pnpm.cmd`, which Node starts only through a shell
 * (CVE-2024-27980); the arguments are then quoted into one command line, since a shell joins
 * them unquoted.
 *
 * @param {string[]} args
 * @param {string} platform
 */
export function pnpmInvocation(args, platform) {
  if (platform !== 'win32') return { command: 'pnpm', args, shell: false };
  return { command: ['pnpm', ...args].map(quoteForCmd).join(' '), args: [], shell: true };
}

/** @param {Pick<ArmSettings, 'packageName' | 'file' | 'config' | 'test'>} settings */
export const vitestArguments = ({ packageName, file, config, test }) => [
  ...['--filter', packageName, 'exec', 'vitest', 'run', file, '--reporter=verbose'],
  ...(config === '' ? [] : ['--config', config]),
  ...(test === '' ? [] : ['-t', test]),
];

/**
 * @typedef {{ command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv }} StartRequest
 * @typedef {{ command: string, args: string[], shell: boolean, cwd: string, logPath: string }} LoggedRequest
 */

/** @param {StartRequest} request */
function startProcess({ command, args, cwd, env }) {
  const child = nodeSpawn(command, args, { cwd, env, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  return { pid: child.pid };
}

/**
 * Runs one command with its output in a log file, and resolves with its exit code.
 *
 * @param {LoggedRequest} request
 * @returns {Promise<number>}
 */
function runLogged({ command, args, shell, cwd, logPath }) {
  const descriptor = fs.openSync(logPath, 'w');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (/** @type {number} */ code) => {
      if (settled) return;
      settled = true;
      fs.closeSync(descriptor);
      resolve(code);
    };
    const stdio = ['ignore', descriptor, descriptor];
    const child = nodeSpawn(command, args, { cwd, shell, stdio, windowsHide: true });
    child.on('error', (error) => {
      fs.appendFileSync(logPath, `could not start ${command}: ${error.message}\n`);
      finish(127);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

/**
 * @typedef {{
 *   git?: Runner, table?: ProcessTable, start?: (request: StartRequest) => { pid?: number },
 *   runLogged?: (request: LoggedRequest) => Promise<number>, sleep?: (ms: number) => Promise<unknown>,
 *   memory?: () => Memory, cores?: number, platform?: string, pathFlavour?: path.PlatformPath,
 *   electron?: (stormApp: string) => string, now?: () => number, env?: NodeJS.ProcessEnv,
 *   print?: (line: string) => void,
 * }} Io
 */

/** @param {Io} io */
function withDefaults(io) {
  const platform = io.platform ?? process.platform;
  return {
    git: io.git ?? defaultGit,
    table: io.table ?? processTable({ platform }),
    start: io.start ?? startProcess,
    runLogged: io.runLogged ?? runLogged,
    sleep: io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    memory: io.memory ?? (() => ({ free: os.freemem(), total: os.totalmem() })),
    cores: io.cores ?? os.availableParallelism(),
    platform,
    pathFlavour: io.pathFlavour ?? (platform === 'win32' ? path.win32 : path.posix),
    electron:
      io.electron ??
      ((stormApp) => String(createRequire(path.join(stormApp, 'package.json'))('electron'))),
    now: io.now ?? Date.now,
    env: io.env ?? process.env,
    print: io.print ?? console.log,
  };
}

/** @param {string} file */
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
/** @param {string} file @param {unknown} value */
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/**
 * Kills every process whose command line carries this arm's tag, then lists the machine again
 * and says what is left. Harmless when the load is already gone. Exit code 1 when anything is.
 *
 * @param {{ out: string, arm: string }} options
 * @param {Io} [io]
 */
export async function stopArm({ out, arm }, io = {}) {
  const { table, sleep, print } = withDefaults(io);
  const loadFile = path.join(out, arm, 'load.json');
  if (!fs.existsSync(loadFile)) {
    print(`no load recorded for arm ${arm}: nothing to stop`);
    return 0;
  }
  /** @type {{ tag: string, pids: { pid: number, name: string }[] }} */
  const { tag, pids } = readJson(loadFile);
  for (const { pid } of carrying(table.list(), tag)) table.kill(pid);
  await sleep(2000);
  const after = table.list();
  const left = carrying(after, tag);
  // A recorded PID counts as alive only under the same name: PIDs are reused.
  const alive = pids.filter(({ pid, name }) =>
    after.some((process) => process.pid === pid && process.name === name),
  );
  const named = left.length === 0 ? '' : ` (${describeProcesses(left).join(', ')})`;
  print(`load stopped: ${left.length} processes left carrying ${tag}${named}`);
  const aliveText = alive.length === 0 ? 'none' : describeProcesses(alive).join(', ');
  print(`recorded load PIDs still alive: ${aliveText}`);
  return left.length === 0 && alive.length === 0 ? 0 : 1;
}

/**
 * Starts the declared load, writing its tag before the first process so a `stop` after a crash
 * still finds it. Resolves with a function that ends the storm's loop.
 *
 * @param {ArmSettings} settings
 * @param {string} folder
 * @param {ReturnType<typeof withDefaults>} io
 * @returns {Promise<() => Promise<void>>}
 */
async function startLoad(settings, folder, io) {
  const { table, start, sleep, cores, pathFlavour, electron, now, env, print } = io;
  if (settings.load === 'none') return async () => {};
  const tag = `flake-load-${settings.arm}-${Math.floor(now() / 1000)}`;
  const loadFile = path.join(folder, 'load.json');
  /** @type {{ tag: string, load: string, pids: { pid: number, name: string }[] }} */
  const record = { tag, load: settings.load, pids: [] };
  writeJson(loadFile, record);
  /** @param {Process[]} processes */
  const remember = (processes) => {
    for (const { pid, name } of processes) {
      if (!record.pids.some((known) => known.pid === pid)) record.pids.push({ pid, name });
    }
    writeJson(loadFile, record);
  };

  if (settings.load === 'cpu') {
    for (let index = 0; index < cores; index += 1) {
      start({ command: process.execPath, args: ['-e', 'for(;;){}', tag] });
    }
    await sleep(2000);
    const burners = carrying(table.list(), tag);
    remember(burners);
    const listed = describeProcesses(burners).join(',');
    print(`load cpu: ${burners.length} processes carry ${tag} (${cores} cores): ${listed}`);
    return async () => {};
  }

  const command = electron(settings.stormApp);
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      for (let instance = 1; instance <= STORM_INSTANCES; instance += 1) {
        fs.mkdirSync(path.join(folder, `${tag}-${instance}`), { recursive: true });
        const at = (/** @type {string} */ name) =>
          pathFlavour.join(folder, `${tag}-${instance}`, name);
        start({
          command,
          args: ['.', `--user-data-dir=${at('data')}`],
          cwd: settings.stormApp,
          env: { ...env, TYTO_HEADLESS: '1', TYTO_HOME: at('home') },
        });
      }
      await sleep(STORM_ROUND_MS);
      const round = carrying(table.list(), tag);
      remember(round);
      for (const { pid } of round) table.kill(pid);
    }
  })();
  const folders = pathFlavour.join(folder, `${tag}-<k>`);
  print(
    `load storm: ${STORM_INSTANCES} app instances relaunched every ${STORM_ROUND_MS / 1000} s, data folders ${folders}`,
  );
  return async () => {
    stopped = true;
    await loop;
  };
}

/**
 * Re-reads one arm's logs and classifies each run. `sig`, when given, replaces the arm's
 * failure text and is kept for the next read.
 *
 * @param {{ out: string, arm: string, sig?: string }} options
 */
export function classifyArm({ out, arm, sig }) {
  const folder = path.join(out, arm);
  /** @type {ArmSettings} */
  const settings = readJson(path.join(folder, 'arm.json'));
  if (sig !== undefined && sig !== settings.sig) {
    settings.sig = sig;
    writeJson(path.join(folder, 'arm.json'), settings);
  }
  const exitsFile = path.join(folder, 'exits.txt');
  const exits = parseExits(fs.existsSync(exitsFile) ? fs.readFileSync(exitsFile, 'utf8') : '');
  const results = Array.from({ length: settings.runs }, (_, index) => {
    const log = path.join(folder, `run-${index + 1}.log`);
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : undefined;
    const found =
      text === undefined
        ? { class: 'other', line: 'no log' }
        : classifyLog({ code: exits.get(index + 1), text, sig: settings.sig });
    return { run: index + 1, ...found };
  });
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(CLASSES.map((name) => [name, 0]));
  for (const result of results) counts[result.class] = (counts[result.class] ?? 0) + 1;
  return { settings, results, counts };
}

/** @param {ArmSettings} settings @param {Record<string, number>} counts */
export function formatRow(settings, counts) {
  const { arm, sha, load, memory, runs } = settings;
  const cells = [arm, sha, load, describeMemory(memory), runs, ...CLASSES.map((c) => counts[c])];
  return `| ${cells.join(' | ')} |`;
}

/**
 * Prints each run's class and the arm's row, and writes them to `classes.txt`.
 *
 * @param {{ out: string, arm: string, sig?: string }} options
 * @param {Io} [io]
 */
export function printClasses(options, io = {}) {
  const { print } = withDefaults(io);
  const { settings, results, counts } = classifyArm(options);
  const runLines = results.map(({ run, class: name, line }) => `run ${run}: ${name} | ${line}`);
  fs.writeFileSync(path.join(options.out, options.arm, 'classes.txt'), `${runLines.join('\n')}\n`);
  for (const line of runLines) print(line);
  print(formatRow(settings, counts));
  return 0;
}

/**
 * One arm: the test `runs` times beside the declared load, then the load stopped and proven
 * gone, then the classes. Exit code 1 when the stop left anything.
 *
 * @param {Omit<ArmSettings, 'sha' | 'memory'> & { out: string }} options
 * @param {Io} [io]
 */
export async function runArm(options, io = {}) {
  const resolved = withDefaults(io);
  const { git, table, runLogged: runOne, sleep, memory, platform, print } = resolved;
  const { out, ...chosen } = options;
  const folder = path.join(out, options.arm);
  fs.mkdirSync(folder, { recursive: true });
  for (const name of ['load.json', 'exits.txt', 'classes.txt']) {
    fs.rmSync(path.join(folder, name), { force: true });
  }
  const sha = git(['rev-parse', '--short', 'HEAD'], { cwd: options.tree }).trim();
  /** @type {ArmSettings} */
  const settings = { ...chosen, sha, memory: memory() };
  writeJson(path.join(folder, 'arm.json'), settings);
  print(
    `arm ${settings.arm} | tree ${settings.tree} at ${sha} | memory ${describeMemory(settings.memory)} | node/electron processes before the load: ${countNodeAndElectron(table.list())}`,
  );

  const endLoad = await startLoad(settings, folder, resolved);
  let exitCode = 0;
  try {
    if (settings.load !== 'none') await sleep(5000);
    const invocation = pnpmInvocation(vitestArguments(settings), platform);
    const exitsFile = path.join(folder, 'exits.txt');
    fs.writeFileSync(exitsFile, '');
    for (let run = 1; run <= settings.runs; run += 1) {
      const logPath = path.join(folder, `run-${run}.log`);
      const code = await runOne({ ...invocation, cwd: settings.tree, logPath });
      fs.appendFileSync(exitsFile, `run ${run} exit ${code}\n`);
      print(`run ${run} exit ${code}`);
    }
  } finally {
    await endLoad();
    if (settings.load !== 'none') exitCode = await stopArm({ out, arm: settings.arm }, io);
  }
  print(`node/electron processes after the load: ${countNodeAndElectron(table.list())}`);
  printClasses({ out, arm: settings.arm }, io);
  return exitCode;
}

/**
 * The arms side by side: each arm's failures counted by their first line, the table of
 * `/flake-hunt` step 7 with those counts in its last column, and the control's luck figure.
 *
 * @param {{ out: string, arms: string[], control: string }} options
 * @param {Io} [io]
 */
export function compareArms({ out, arms, control }, io = {}) {
  const { print } = withDefaults(io);
  const classified = [];
  for (const arm of arms) {
    if (fs.existsSync(path.join(out, arm, 'arm.json'))) classified.push(classifyArm({ out, arm }));
    else print(`${arm}: no arm.json in ${path.join(out, arm)}: not run`);
  }
  const rows = classified.map(({ settings, results, counts }) => {
    /** @type {Map<string, number>} */
    const seen = new Map();
    for (const { class: name, line } of results.filter((result) => result.class !== 'pass')) {
      seen.set(`${name} | ${line}`, (seen.get(`${name} | ${line}`) ?? 0) + 1);
    }
    const failures = [...seen].sort().map(([key, count]) => `${count}× ${key}`);
    print(`${settings.arm}:`);
    for (const failure of failures.length === 0 ? ['no failure'] : failures) print(`  ${failure}`);
    const cell = failures.length === 0 ? 'none' : failures.join('; ').replace(/\|/gu, '\\|');
    return `${formatRow(settings, counts)} ${cell} |`;
  });

  const header = ['Arm', 'Tree', 'Load', 'Free memory', 'Runs', 'Pass', 'Flake', 'Launch'];
  const columns = [...header, 'Worker', 'Other', 'Failure first lines'];
  print('');
  print(`| ${columns.join(' | ')} |`);
  print(`| ${columns.map((name) => '-'.repeat(Math.max(3, name.length))).join(' | ')} |`);
  for (const row of rows) print(row);
  print('');

  const controlArm = classified.find(({ settings }) => settings.arm === control);
  if (controlArm === undefined) {
    print(`no conclusion: no control arm (${control}) was run`);
    return 0;
  }
  const { counts, settings } = controlArm;
  const red = counts.flake ?? 0;
  print(
    red === 0
      ? `no conclusion: the load did not turn the old code red (${control}: 0 flake of ${settings.runs} under ${settings.load})`
      : `${control} went red ${red} of ${settings.runs} under ${settings.load}: a tree with the same defect shows 0 of ${settings.runs} under the same load with chance (1 − ${red}/${settings.runs})^${settings.runs} ≈ ${formatPercent(luck(red, settings.runs))}`,
  );
  return 0;
}

const USAGE = `usage:
  flake-hunt.mjs arm <arm> --load none|cpu|storm --cwd <tree> --out <hunt folder> --package <name> --file <test file> [--test <name>] [--sig <text>] [--config <file>] [--runs 10] [--storm-app <apps/desktop>]
  flake-hunt.mjs stop <arm> --out <hunt folder>
  flake-hunt.mjs classify <arm> --out <hunt folder> [--sig <text>]
  flake-hunt.mjs compare --out <hunt folder> [--arms idle,load,control] [--control control]`;

const FLAGS = {
  arm: ['load', 'cwd', 'out', 'package', 'file', 'test', 'sig', 'config', 'runs', 'storm-app'],
  stop: ['out'],
  classify: ['out', 'sig'],
  compare: ['out', 'arms', 'control'],
};

/**
 * Reads the mode, the arm and the flags, and says what is wrong with them.
 *
 * @param {string[]} argv
 * @returns {{ mode: string, arm: string, flags: Record<string, string> } | { error: string }}
 */
export function parseArguments(argv) {
  const [mode = '', ...rest] = argv;
  if (!Object.hasOwn(FLAGS, mode)) return { error: `unknown mode: ${mode || '(none)'}` };
  const allowed = FLAGS[/** @type {keyof typeof FLAGS} */ (mode)];
  const arm = mode === 'compare' ? '' : (rest.shift() ?? '');
  if (mode !== 'compare' && !/^[\w-]+$/u.test(arm)) return { error: `${mode} needs an arm name` };
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
  const required = mode === 'arm' ? ['load', 'cwd', 'out', 'package', 'file'] : ['out'];
  const missing = required.filter((name) => flags[name] === undefined);
  if (missing.length > 0) return { error: `missing --${missing.join(' --')}` };
  if (mode !== 'arm') return { mode, arm, flags };
  if (!LOADS.includes(flags.load ?? '')) return { error: `--load must be ${LOADS.join(', ')}` };
  if (flags.load === 'storm' && flags['storm-app'] === undefined) {
    return { error: '--load storm needs --storm-app' };
  }
  if (!/^[1-9]\d*$/u.test(flags.runs ?? '10')) return { error: '--runs must be a whole number' };
  return { mode, arm, flags };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`${parsed.error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const { mode, arm, flags } = parsed;
  const out = path.resolve(flags.out ?? '.');
  if (mode === 'stop') process.exitCode = await stopArm({ out, arm });
  else if (mode === 'classify') process.exitCode = printClasses({ out, arm, sig: flags.sig });
  else if (mode === 'compare') {
    const arms = (flags.arms ?? 'idle,load,control').split(',').filter((name) => name !== '');
    process.exitCode = compareArms({ out, arms, control: flags.control ?? 'control' });
  } else {
    // An interrupt still stops the load; a tool timeout that kills the tree does not get here.
    const interrupt = () => void stopArm({ out, arm }).finally(() => process.exit(143));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    process.exitCode = await runArm({
      arm,
      out,
      tree: path.resolve(flags.cwd ?? '.'),
      load: flags.load ?? 'none',
      packageName: flags.package ?? '',
      file: flags.file ?? '',
      test: flags.test ?? '',
      sig: flags.sig ?? '',
      config: flags.config ?? '',
      runs: Number(flags.runs ?? '10'),
      stormApp: flags['storm-app'] ?? '',
    });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
