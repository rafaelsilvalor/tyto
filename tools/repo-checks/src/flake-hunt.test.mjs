import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyLog,
  compareArms,
  formatPercent,
  luck,
  parseArguments,
  parseExits,
  pnpmInvocation,
  printClasses,
  processTable,
  quoteForCmd,
  runArm,
  stopArm,
  vitestArguments,
  WINDOWS_PROCESS_LIST,
} from './flake-hunt.mjs';

const red = (text) => `${String.fromCharCode(27)}[31m${text}${String.fromCharCode(27)}[39m`;
const GB = 1024 ** 3;
const PASS_LOG = ` ${red('✓')} src/age.test.ts > age\n ${red('Tests')}  22 passed (22)\n`;
const ASSERTION_LOG = ' FAIL src/age.test.ts\nAssertionError: expected 1 to be 2\n';
const WORKER_LOG = 'Error: Timeout waiting for worker\n';

/** A runner that answers only the calls it was given, and throws on any other. */
function fakeExec(answers) {
  const calls = [];
  const exec = (command, args) => {
    const key = [command, ...args].join(' ');
    calls.push(key);
    if (!(key in answers)) throw new Error(`unexpected call: ${key}`);
    if (answers[key] instanceof Error) throw answers[key];
    return answers[key];
  };
  return { exec, calls };
}

/** A process table held in memory: `kill` removes the process, and is recorded. */
function fakeTable(processes) {
  const killed = [];
  const kill = (pid) => {
    killed.push(pid);
    const index = processes.findIndex((process) => process.pid === pid);
    if (index >= 0) processes.splice(index, 1);
  };
  return { killed, processes, kill, list: () => processes.map((process) => ({ ...process })) };
}

/** Another session's processes: a hunt never touches them. */
const neighbours = () => [
  { pid: 10, name: 'node.exe', commandLine: 'node other-session.js' },
  { pid: 11, name: 'electron.exe', commandLine: 'electron . --user-data-dir=C:\\elsewhere' },
  { pid: 12, name: 'explorer.exe', commandLine: 'explorer.exe' },
];

const gitAt = (sha) => (args) => {
  if (args.join(' ') !== 'rev-parse --short HEAD') throw new Error(`unexpected git ${args}`);
  return `${sha}\n`;
};

function printer() {
  const printed = [];
  return { printed, print: (line) => printed.push(line) };
}

let out;
beforeEach(() => {
  out = mkdtempSync(path.join(os.tmpdir(), 'flake-hunt-test-'));
});
afterEach(() => rmSync(out, { recursive: true, force: true }));

/** An arm on disk as `arm` leaves it: settings, exits and one log per run. */
function writeArm(arm, { load = 'cpu', exits, logs, sig = '' }) {
  const folder = path.join(out, arm);
  mkdirSync(folder, { recursive: true });
  const settings = {
    arm,
    tree: `/trees/${arm}`,
    sha: 'abc1234',
    load,
    packageName: '@tyto/recipe',
  };
  Object.assign(settings, { file: 'src/age.test.ts', test: '', sig, config: '', stormApp: '' });
  Object.assign(settings, { runs: exits.length, memory: { free: 8 * GB, total: 16 * GB } });
  writeFileSync(path.join(folder, 'arm.json'), JSON.stringify(settings));
  const exitLines = exits.map((code, index) => `run ${index + 1} exit ${code}\n`);
  writeFileSync(path.join(folder, 'exits.txt'), exitLines.join(''));
  logs.forEach((log, index) => writeFileSync(path.join(folder, `run-${index + 1}.log`), log));
}

describe('classifyLog', () => {
  it('reads a pass with its Tests line, past the ANSI colours', () => {
    expect(classifyLog({ code: 0, text: PASS_LOG })).toEqual({
      class: 'pass',
      line: 'Tests  22 passed (22)',
    });
  });

  it('counts an AssertionError as the flake when no failure text is set, coloured or not', () => {
    const flake = { class: 'flake', line: 'AssertionError: expected 1 to be 2' };
    expect(classifyLog({ code: 1, text: ASSERTION_LOG })).toEqual(flake);
    expect(classifyLog({ code: 1, text: `  ${red('AssertionError')}: x` }).class).toBe('flake');
  });

  it('counts only the failure text when one is set', () => {
    const timeout = 'TimeoutError: waitForSelector .tab timed out 5000ms';
    const text = `${timeout}\nAssertionError: x\n`;
    expect(classifyLog({ code: 1, text, sig: 'waitForSelector .tab' })).toEqual({
      class: 'flake',
      line: timeout,
    });
    expect(classifyLog({ code: 1, text: 'AssertionError: x\n', sig: 'waitFor' })).toEqual({
      class: 'other',
      line: 'AssertionError: x',
    });
  });

  it('counts the flake before the worker when a log holds both', () => {
    expect(classifyLog({ code: 1, text: `${WORKER_LOG}${ASSERTION_LOG}` }).class).toBe('flake');
  });

  it('calls a worker timeout with no AssertionError machine load', () => {
    expect(classifyLog({ code: 1, text: red(WORKER_LOG) })).toEqual({
      class: 'worker',
      line: 'Error: Timeout waiting for worker',
    });
    const forks = 'Failed to start forks worker for test files\n';
    expect(classifyLog({ code: 1, text: forks }).class).toBe('worker');
  });

  it('calls a hook timeout before any passing test a launch failure, and after one not', () => {
    const hook = 'Error: Hook timed out in 60000ms.\n';
    expect(classifyLog({ code: 1, text: hook })).toEqual({ class: 'launch', line: hook.trim() });
    expect(classifyLog({ code: 1, text: ` ✓ opens\n${hook}` }).class).toBe('other');
    const launch = 'electron.launch: Process failed to launch!\n';
    expect(classifyLog({ code: 1, text: launch }).class).toBe('launch');
    const window = 'page.firstWindow: Timeout 30000ms exceeded\n';
    expect(classifyLog({ code: 1, text: window }).class).toBe('launch');
  });

  it('leaves anything else as other, with its first error line', () => {
    expect(classifyLog({ code: 1, text: 'noise\nTypeError: x is undefined\n' })).toEqual({
      class: 'other',
      line: 'TypeError: x is undefined',
    });
    expect(classifyLog({ code: undefined, text: '' })).toEqual({ class: 'other', line: '' });
  });
});

describe('parseExits and luck', () => {
  it('reads each run’s exit code, with Windows line ends', () => {
    expect([...parseExits('run 1 exit 0\r\nrun 2 exit 1\nnoise\n')]).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it('computes (1 − k/N)^N, with the command’s two examples', () => {
    expect(formatPercent(luck(4, 10))).toBe('0.6%');
    expect(formatPercent(luck(1, 10))).toBe('35%');
    expect([luck(0, 10), luck(10, 10)]).toEqual([1, 0]);
  });
});

describe('processTable', () => {
  const listWindows = `powershell -NoProfile -Command ${WINDOWS_PROCESS_LIST}`;

  it('lists every process on Windows through Get-CimInstance, as JSON', () => {
    const json = JSON.stringify([
      { ProcessId: 4, Name: 'System', CommandLine: null },
      { ProcessId: 36744, Name: 'node.exe', CommandLine: 'node -e for(;;){} flake-load-cpu-1' },
    ]);
    const { exec, calls } = fakeExec({ [listWindows]: json });
    expect(processTable({ platform: 'win32', exec }).list()).toEqual([
      { pid: 4, name: 'System', commandLine: '' },
      { pid: 36744, name: 'node.exe', commandLine: 'node -e for(;;){} flake-load-cpu-1' },
    ]);
    expect(calls).toEqual([listWindows]);
  });

  it('reads a single Windows process, which ConvertTo-Json prints as an object', () => {
    const { exec } = fakeExec({
      [listWindows]: '{"ProcessId":7,"Name":"a.exe","CommandLine":"a"}\r\n',
    });
    const listed = processTable({ platform: 'win32', exec }).list();
    expect(listed).toEqual([{ pid: 7, name: 'a.exe', commandLine: 'a' }]);
  });

  it('kills one PID with taskkill on Windows, and shrugs when it is gone', () => {
    const gone = new Error('not found');
    const { exec, calls } = fakeExec({
      'taskkill /PID 36744 /F': 'SUCCESS',
      'taskkill /PID 5 /F': gone,
    });
    const table = processTable({ platform: 'win32', exec });
    table.kill(36744);
    table.kill(5);
    expect(calls).toEqual(['taskkill /PID 36744 /F', 'taskkill /PID 5 /F']);
  });

  it('lists every process on POSIX through pgrep -af, and an empty table on exit 1', () => {
    const output = '  101 /usr/bin/node -e for(;;){} flake-load-cpu-1\n202 bash\n';
    const { exec } = fakeExec({ 'pgrep -af .': output });
    expect(processTable({ platform: 'linux', exec }).list()).toEqual([
      { pid: 101, name: 'node', commandLine: '/usr/bin/node -e for(;;){} flake-load-cpu-1' },
      { pid: 202, name: 'bash', commandLine: 'bash' },
    ]);
    const failing = (status) =>
      fakeExec({ 'pgrep -af .': Object.assign(new Error(`exit ${status}`), { status }) }).exec;
    expect(processTable({ platform: 'linux', exec: failing(1) }).list()).toEqual([]);
    expect(() => processTable({ platform: 'linux', exec: failing(2) }).list()).toThrow('exit 2');
  });

  it('kills one PID with kill -KILL on POSIX', () => {
    const { exec, calls } = fakeExec({ 'kill -KILL 101': '' });
    processTable({ platform: 'darwin', exec }).kill(101);
    expect(calls).toEqual(['kill -KILL 101']);
  });
});

describe('pnpmInvocation', () => {
  const args = vitestArguments({
    packageName: '@tyto/desktop',
    file: 'e2e/tabs.desktop.test.ts',
    config: 'vitest.desktop.config.ts',
    test: 'keeps "the" tab',
  });

  it('starts pnpm through a shell on Windows, with the arguments quoted into one line', () => {
    expect(pnpmInvocation(args, 'win32')).toEqual({
      command:
        'pnpm --filter @tyto/desktop exec vitest run e2e/tabs.desktop.test.ts --reporter=verbose --config vitest.desktop.config.ts -t "keeps ""the"" tab"',
      args: [],
      shell: true,
    });
    expect([quoteForCmd('a b'), quoteForCmd('src/age.test.ts')]).toEqual([
      '"a b"',
      'src/age.test.ts',
    ]);
  });

  it('starts pnpm directly elsewhere, with the arguments as they are', () => {
    expect(pnpmInvocation(args, 'linux')).toEqual({ command: 'pnpm', args, shell: false });
    expect(args.slice(-2)).toEqual(['-t', 'keeps "the" tab']);
  });
});

describe('stopArm', () => {
  const tag = 'flake-load-cpu-1793995938';
  const sleep = async () => {};
  function recordLoad(arm, pids) {
    mkdirSync(path.join(out, arm), { recursive: true });
    writeFileSync(path.join(out, arm, 'load.json'), JSON.stringify({ tag, load: 'cpu', pids }));
  }
  const burner = (pid) => ({ pid, name: 'node.exe', commandLine: `node -e for(;;){} ${tag}` });

  it('kills only the processes carrying the tag, and proves them gone', async () => {
    const table = fakeTable([...neighbours(), burner(36744), burner(25548)]);
    recordLoad('cpu', [burner(36744), burner(25548)]);
    const { printed, print } = printer();
    expect(await stopArm({ out, arm: 'cpu' }, { table, sleep, print })).toBe(0);
    expect(table.killed.sort()).toEqual([25548, 36744]);
    expect(table.processes).toEqual(neighbours());
    expect(printed).toEqual([
      `load stopped: 0 processes left carrying ${tag}`,
      'recorded load PIDs still alive: none',
    ]);
  });

  it('is harmless when there is no load, or when it already stopped', async () => {
    const table = fakeTable(neighbours());
    const { printed, print } = printer();
    expect(await stopArm({ out, arm: 'idle' }, { table, sleep, print })).toBe(0);
    recordLoad('cpu', [burner(36744)]);
    expect(await stopArm({ out, arm: 'cpu' }, { table, sleep, print })).toBe(0);
    expect(table.killed).toEqual([]);
    expect(printed[0]).toBe('no load recorded for arm idle: nothing to stop');
  });

  it('names what is left and fails when a recorded PID survives under its name', async () => {
    // 41 ignores the kill; 42 was recorded and lost its tag; 10 is a reused PID.
    const survivor = { pid: 42, name: 'electron.exe', commandLine: 'electron --type=gpu' };
    const table = fakeTable([...neighbours(), burner(41), survivor]);
    table.kill = (pid) => table.killed.push(pid);
    recordLoad('storm', [survivor, { pid: 10, name: 'electron.exe' }]);
    const { printed, print } = printer();
    expect(await stopArm({ out, arm: 'storm' }, { table, sleep, print })).toBe(1);
    expect(table.killed).toEqual([41]);
    expect(printed).toEqual([
      `load stopped: 1 processes left carrying ${tag} (node.exe 41)`,
      'recorded load PIDs still alive: electron.exe 42',
    ]);
  });
});

describe('runArm', () => {
  const options = (arm, load, extra = {}) => ({
    ...{ arm, out, tree: `/trees/${arm}`, load, packageName: '@tyto/recipe' },
    ...{ file: 'src/age.test.ts', test: '', sig: '', config: '', runs: 3, stormApp: '' },
    ...extra,
  });

  /** Writes each run's log from a list of outcomes, and records each call. */
  function fakeRuns(outcomes) {
    const calls = [];
    const runLogged = async (request) => {
      calls.push(request);
      const [code, log] = outcomes[calls.length - 1];
      writeFileSync(request.logPath, log);
      return code;
    };
    return { calls, runLogged };
  }

  /** Starts a fake process that carries its arguments in its command line. */
  function fakeStart(table, name, firstPid) {
    const started = [];
    const start = (request) => {
      started.push(request);
      const pid = firstPid + started.length - 1;
      table.processes.push({ pid, name, commandLine: [name, ...request.args].join(' ') });
      return { pid };
    };
    return { started, start };
  }

  const io = (extra) => ({
    git: gitAt('6b0326fc'),
    sleep: async () => {},
    memory: () => ({ free: 8 * GB, total: 16 * GB }),
    now: () => 1793995938000,
    ...extra,
  });

  it('runs a cpu arm beside tagged burners, stops only those, and prints the row', async () => {
    const table = fakeTable(neighbours());
    const { started, start } = fakeStart(table, 'node.exe', 500);
    const { calls, runLogged } = fakeRuns([
      [0, PASS_LOG],
      [1, ASSERTION_LOG],
      [1, WORKER_LOG],
    ]);
    const { printed, print } = printer();
    const memory = () => ({ free: 1.1 * GB, total: 15.8 * GB });
    const extra = { table, start, runLogged, memory, cores: 2, platform: 'win32', print };
    expect(await runArm(options('load', 'cpu'), io(extra))).toBe(0);

    const tag = 'flake-load-load-1793995938';
    expect(started.map(({ args }) => args)).toEqual(Array(2).fill(['-e', 'for(;;){}', tag]));
    expect(table.killed.sort()).toEqual([500, 501]);
    expect(table.processes).toEqual(neighbours());
    expect(calls.map(({ shell, cwd }) => ({ shell, cwd }))).toEqual(
      Array(3).fill({ shell: true, cwd: '/trees/load' }),
    );
    expect(printed).toEqual([
      'arm load | tree /trees/load at 6b0326fc | memory 1.1 GB free of 15.8 GB | node/electron processes before the load: 2',
      `load cpu: 2 processes carry ${tag} (2 cores): node.exe 500,node.exe 501`,
      'run 1 exit 0',
      'run 2 exit 1',
      'run 3 exit 1',
      `load stopped: 0 processes left carrying ${tag}`,
      'recorded load PIDs still alive: none',
      'node/electron processes after the load: 2',
      'run 1: pass | Tests  22 passed (22)',
      'run 2: flake | AssertionError: expected 1 to be 2',
      'run 3: worker | Error: Timeout waiting for worker',
      '| load | 6b0326fc | cpu | 1.1 GB free of 15.8 GB | 3 | 1 | 1 | 0 | 1 | 0 |',
    ]);
    expect(readFileSync(path.join(out, 'load', 'classes.txt'), 'utf8')).toContain('run 2: flake');
  });

  it('runs an idle arm with no load, and leaves nothing for stop to find', async () => {
    const table = fakeTable(neighbours());
    const start = () => {
      throw new Error('an idle arm starts no load');
    };
    const { calls, runLogged } = fakeRuns(Array(3).fill([0, PASS_LOG]));
    const { printed, print } = printer();
    await runArm(
      options('idle', 'none'),
      io({ table, start, runLogged, platform: 'linux', print }),
    );
    expect(calls[0]).toMatchObject({ command: 'pnpm', shell: false });
    expect(printed.at(-1)).toBe(
      '| idle | 6b0326fc | none | 8.0 GB free of 16.0 GB | 3 | 3 | 0 | 0 | 0 | 0 |',
    );
    const stop = printer();
    expect(await stopArm({ out, arm: 'idle' }, { table, print: stop.print })).toBe(0);
    expect(stop.printed).toEqual(['no load recorded for arm idle: nothing to stop']);
  });

  it('relaunches the storm’s app instances, each in its own tagged data folder', async () => {
    const table = fakeTable(neighbours());
    const { started, start } = fakeStart(table, 'electron.exe', 700);
    const { runLogged } = fakeRuns([[0, PASS_LOG]]);
    const { printed, print } = printer();
    const app = 'C:\\tree\\apps\\desktop';
    const extra = { table, start, runLogged, platform: 'win32', pathFlavour: path.win32, print };
    Object.assign(extra, { electron: (at) => `${at}\\electron.exe`, env: { PATH: 'x' } });
    await runArm(options('storm', 'storm', { runs: 1, stormApp: app }), io(extra));

    const tag = 'flake-load-storm-1793995938';
    expect(started.length).toBeGreaterThanOrEqual(3);
    expect(started.length % 3).toBe(0);
    started.slice(0, 3).forEach((request, index) => {
      const folder = path.win32.join(out, 'storm', `${tag}-${index + 1}`);
      expect(request).toEqual({
        command: `${app}\\electron.exe`,
        args: ['.', `--user-data-dir=${path.win32.join(folder, 'data')}`],
        cwd: app,
        env: { PATH: 'x', TYTO_HEADLESS: '1', TYTO_HOME: path.win32.join(folder, 'home') },
      });
    });
    expect(table.processes).toEqual(neighbours());
    expect(printed).toContain(`load stopped: 0 processes left carrying ${tag}`);
  });
});

describe('printClasses', () => {
  it('re-reads the logs with a new failure text, and keeps it', () => {
    const timeout = 'TimeoutError: waitForSelector .tab timed out';
    writeArm('load', { exits: [1, 1], logs: [`${timeout}\n`, 'Error: other\n'] });
    const read = (sig) => {
      const { printed, print } = printer();
      printClasses({ out, arm: 'load', sig }, { print });
      return printed;
    };
    expect(read()[0]).toBe(`run 1: other | ${timeout}`);
    expect(read('waitForSelector .tab')[0]).toBe(`run 1: flake | ${timeout}`);
    expect(read()[0]).toBe(`run 1: flake | ${timeout}`);
  });
});

describe('compareArms', () => {
  const header = [
    '| Arm | Tree | Load | Free memory | Runs | Pass | Flake | Launch | Worker | Other | Failure first lines |',
    '| --- | ---- | ---- | ----------- | ---- | ---- | ----- | ------ | ------ | ----- | ------------------- |',
  ];

  it('prints the failures, the table and the luck of a red control', () => {
    writeArm('idle', { load: 'none', exits: [0, 0, 0], logs: Array(3).fill(PASS_LOG) });
    writeArm('load', { exits: [0, 0, 0], logs: Array(3).fill(PASS_LOG) });
    writeArm('control', { exits: [1, 0, 1], logs: [ASSERTION_LOG, PASS_LOG, ASSERTION_LOG] });
    const { printed, print } = printer();
    compareArms({ out, arms: ['idle', 'load', 'control'], control: 'control' }, { print });
    expect(printed).toEqual([
      ...['idle:', '  no failure', 'load:', '  no failure', 'control:'],
      '  2× flake | AssertionError: expected 1 to be 2',
      '',
      ...header,
      '| idle | abc1234 | none | 8.0 GB free of 16.0 GB | 3 | 3 | 0 | 0 | 0 | 0 | none |',
      '| load | abc1234 | cpu | 8.0 GB free of 16.0 GB | 3 | 3 | 0 | 0 | 0 | 0 | none |',
      '| control | abc1234 | cpu | 8.0 GB free of 16.0 GB | 3 | 1 | 2 | 0 | 0 | 0 | 2× flake \\| AssertionError: expected 1 to be 2 |',
      '',
      'control went red 2 of 3 under cpu: a tree with the same defect shows 0 of 3 under the same load with chance (1 − 2/3)^3 ≈ 3.7%',
    ]);
  });

  it('says no conclusion for a green control, and names an arm that was not run', () => {
    writeArm('control', { exits: [0, 0], logs: [PASS_LOG, PASS_LOG] });
    const { printed, print } = printer();
    compareArms({ out, arms: ['idle', 'control'], control: 'control' }, { print });
    expect(printed[0]).toBe(`idle: no arm.json in ${path.join(out, 'idle')}: not run`);
    expect(printed.at(-1)).toBe(
      'no conclusion: the load did not turn the old code red (control: 0 flake of 2 under cpu)',
    );
  });
});

describe('parseArguments', () => {
  const parse = (line) => parseArguments(line === '' ? [] : line.split(' '));
  const arm = 'arm x --out /h --cwd /t --package p --file f';

  it('reads a whole arm call', () => {
    expect(parse(`${arm} --load cpu --runs 3`)).toEqual({
      mode: 'arm',
      arm: 'x',
      flags: { out: '/h', cwd: '/t', package: 'p', file: 'f', load: 'cpu', runs: '3' },
    });
  });

  it('says what is wrong with a call', () => {
    const errors = {
      '': 'unknown mode: (none)',
      toString: 'unknown mode: toString',
      stop: 'stop needs an arm name',
      'stop cpu': 'missing --out',
      'stop cpu --out /h --load cpu': 'stop takes no --load',
      'arm x --out /h': 'missing --load --cwd --package --file',
      [`${arm} --load disk`]: '--load must be none, cpu, storm',
      [`${arm} --load storm`]: '--load storm needs --storm-app',
      [`${arm} --load cpu --runs 0`]: '--runs must be a whole number',
      'compare --out /h --arms': '--arms needs a value',
    };
    for (const [line, error] of Object.entries(errors)) expect(parse(line).error, line).toBe(error);
  });
});
