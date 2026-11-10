import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { PluginCapabilityError, type ProcessExit } from '@tyto/plugin-api';
import { afterAll, describe, expect, it } from 'vitest';

import {
  type PluginScripts,
  type ProgramChild,
  type ProgramSpawnOptions,
  batchArgumentProblem,
  batchCommand,
  findPluginProgram,
  killProgramTree,
  pluginPrograms,
  pluginScriptFile,
  programEnvironment,
} from './plugin-programs.js';
import type { WorkspaceState } from './workspace.js';

/**
 * The desktop's half of `process:<name>` (TYTO-568, ADR 0182 decision 8): finding the program,
 * its environment, `cmd.exe` for a `.cmd`, a restricted folder, and the programs ended when the
 * folder or its trust changes. The Windows rules run on every system; the last block starts a
 * real program, a `.cmd` under a folder with a space on Windows and a script elsewhere.
 */

const files = (...present: string[]) => {
  const set = new Set(present);
  return (path: string): boolean => set.has(path);
};

describe('findPluginProgram', () => {
  const windows = (path: string, pathext?: string) => ({
    platform: 'win32' as const,
    environment: { Path: path, ...(pathext === undefined ? {} : { PATHEXT: pathext }) },
  });

  it('prefers an .exe to an npm .cmd, and never the extensionless script beside it', () => {
    const folder = 'C:\\Users\\Ana Maria\\AppData\\Roaming\\npm';
    expect(
      findPluginProgram(
        { ...windows(folder), exists: files(`${folder}\\claude`, `${folder}\\claude.cmd`) },
        'claude',
      ),
    ).toBe(`${folder}\\claude.cmd`);
    expect(
      findPluginProgram(
        {
          ...windows(`C:\\first;${folder}`),
          exists: files('C:\\first\\claude.cmd', `${folder}\\claude.exe`, 'C:\\first\\claude'),
        },
        'claude',
      ),
    ).toBe('C:\\first\\claude.cmd');
    expect(
      findPluginProgram(
        { ...windows(folder), exists: files(`${folder}\\claude.cmd`, `${folder}\\claude.exe`) },
        'claude',
      ),
    ).toBe(`${folder}\\claude.exe`);
  });

  it('never runs a .ps1, and only what PATHEXT allows', () => {
    expect(
      findPluginProgram({ ...windows('C:\\bin'), exists: files('C:\\bin\\claude.ps1') }, 'claude'),
    ).toBeUndefined();
    expect(
      findPluginProgram(
        { ...windows('C:\\bin', '.EXE'), exists: files('C:\\bin\\claude.cmd') },
        'claude',
      ),
    ).toBeUndefined();
  });

  it('finds the bare name on POSIX, and skips a relative PATH entry', () => {
    const posix = { platform: 'linux' as const, environment: { PATH: 'bin:/usr/local/bin' } };
    expect(
      findPluginProgram(
        { ...posix, exists: files('bin/claude', '/usr/local/bin/claude') },
        'claude',
      ),
    ).toBe('/usr/local/bin/claude');
    expect(findPluginProgram({ ...posix, exists: files() }, 'claude')).toBeUndefined();
  });
});

describe('programEnvironment', () => {
  it('keeps the allowlist with its spelling, adds TYTO_WINDOW, and passes no secret', () => {
    const kept = programEnvironment(
      {
        Path: 'C:\\bin',
        USERPROFILE: 'C:\\Users\\ana',
        APPDATA: 'C:\\Users\\ana\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local',
        ProgramData: 'C:\\ProgramData',
        SystemRoot: 'C:\\Windows',
        ComSpec: 'C:\\Windows\\system32\\cmd.exe',
        PATHEXT: '.EXE;.CMD',
        HOME: '/home/ana',
        LANG: 'pt_BR.UTF-8',
        LC_ALL: 'pt_BR.UTF-8',
        https_proxy: 'http://proxy:3128',
        NO_PROXY: 'localhost',
        ANTHROPIC_API_KEY: 'sk-ant',
        OPENAI_API_KEY: 'sk-openai',
        GH_TOKEN: 'ghp',
        LC_API_KEY: 'shaped like a secret behind a kept prefix',
        TYTO_PLUGIN_TEXTO_API_TOKEN: 'secret',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--inspect',
        SHELL: '/bin/zsh',
        UNSET: undefined,
      },
      4242,
    );
    expect(kept).toEqual({
      Path: 'C:\\bin',
      USERPROFILE: 'C:\\Users\\ana',
      APPDATA: 'C:\\Users\\ana\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local',
      ProgramData: 'C:\\ProgramData',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      PATHEXT: '.EXE;.CMD',
      HOME: '/home/ana',
      LANG: 'pt_BR.UTF-8',
      LC_ALL: 'pt_BR.UTF-8',
      https_proxy: 'http://proxy:3128',
      NO_PROXY: 'localhost',
      TYTO_WINDOW: '4242',
    });
  });
});

describe('batchCommand', () => {
  const environment = { SystemRoot: 'C:\\Windows' };

  it('runs a .cmd under a folder with a space through cmd.exe, quoted once', () => {
    expect(
      batchCommand(environment, 'C:\\Users\\Ana Maria\\npm\\claude.cmd', [
        '--acp',
        'two words',
        '',
      ]),
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Users\\Ana Maria\\npm\\claude.cmd" --acp "two words" """'],
    });
  });

  it('refuses every character cmd.exe reads as its own, rather than escaping it', () => {
    for (const unsafe of ['"', '%', '^', '&', '|', '<', '>', '(', ')', '!', '\r', '\n']) {
      expect(batchArgumentProblem(`a${unsafe}b`), JSON.stringify(unsafe)).toBeDefined();
      expect('problem' in batchCommand(environment, 'C:\\npm\\claude.cmd', [`a${unsafe}b`])).toBe(
        true,
      );
    }
    expect(batchArgumentProblem('--model=sonnet-4.5,C:\\path\\x.json')).toBeUndefined();
    expect('problem' in batchCommand(environment, 'C:\\100%\\claude.cmd', [])).toBe(true);
  });
});

/** A child that does nothing until the test says so. */
function fakeChild(pid = 7) {
  const listeners: Record<string, ((...args: never[]) => void)[]> = {};
  const add = (event: string, listener: (...args: never[]) => void): void => {
    (listeners[event] ??= []).push(listener);
  };
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners[event] ?? []) (listener as (...a: unknown[]) => void)(...args);
  };
  const child: ProgramChild = {
    pid,
    stdin: { write: (_bytes, done) => done(), end: (done) => done?.(), on: () => undefined },
    stdout: { on: (_event, listener) => add('stdout', listener) },
    stderr: { on: (_event, listener) => add('stderr', listener) },
    once: (event: string, listener: (...args: never[]) => void) => add(event, listener),
    on: (event: string, listener: (...args: never[]) => void) => add(event, listener),
  } as ProgramChild;
  return { child, emit };
}

function host(
  options: {
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
    place?: { folder: string | null; trust: WorkspaceState['trust'] };
    scripts?: PluginScripts;
    dataFolderOf?: (plugin: string) => string;
    environment?: Readonly<Record<string, string | undefined>>;
  } = {},
) {
  const place = { value: options.place ?? { folder: '/work', trust: 'trusted' as const } };
  const spawned: { file: string; args: readonly string[]; options: ProgramSpawnOptions }[] = [];
  const children: ReturnType<typeof fakeChild>[] = [];
  const killed: number[] = [];
  /** Whether each kill had to finish before it returned: the window closing. */
  const waited: boolean[] = [];
  const looked: string[] = [];
  const programs = pluginPrograms({
    platform: options.platform ?? 'linux',
    environment: () =>
      options.environment ?? { PATH: '/bin', Path: undefined, SystemRoot: 'C:\\Windows' },
    exists: (path) => {
      looked.push(path);
      return (options.exists ?? files('/bin/claude'))(path);
    },
    workspace: () => place.value as Pick<WorkspaceState, 'folder' | 'trust'>,
    home: '/home/ana',
    windowPid: 99,
    spawn: (file, args, spawnOptions) => {
      spawned.push({ file, args, options: spawnOptions });
      const made = fakeChild(spawned.length);
      children.push(made);
      queueMicrotask(() => made.emit('spawn'));
      return made.child;
    },
    killTree: (child, now) => {
      killed.push(child.pid ?? -1);
      waited.push(now);
    },
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
    ...(options.dataFolderOf === undefined ? {} : { dataFolderOf: options.dataFolderOf }),
  });
  const quiet = { stdout: () => undefined, stderr: () => undefined, exit: () => undefined };
  return { programs, place, spawned, children, killed, waited, looked, quiet };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'started';
  } catch (cause) {
    return cause instanceof PluginCapabilityError ? cause.code : String(cause);
  }
}

describe('pluginPrograms', () => {
  it('refuses a restricted folder before it looks for the program', async () => {
    const test = host({ place: { folder: '/work', trust: 'restricted' } });
    expect(await codeOf(test.programs.startProcess('agente', 'claude', [], test.quiet))).toBe(
      'E_PROCESS_RESTRICTED',
    );
    expect(test.looked).toEqual([]);
    expect(test.spawned).toEqual([]);
  });

  it('answers E_PROCESS_NOT_FOUND for a program on no PATH folder', async () => {
    const test = host({ exists: files() });
    expect(await codeOf(test.programs.startProcess('agente', 'claude', [], test.quiet))).toBe(
      'E_PROCESS_NOT_FOUND',
    );
  });

  it('runs it in the open folder, or home with none, with no shell and the kept environment', async () => {
    const test = host();
    const inFolder = await test.programs.startProcess('agente', 'claude', ['--acp'], test.quiet);
    test.place.value = { folder: null, trust: 'trusted' };
    const atHome = await test.programs.startProcess('agente', 'claude', [], test.quiet);
    expect(test.spawned.map(({ file, args, options }) => [file, args, options.cwd])).toEqual([
      ['/bin/claude', ['--acp'], '/work'],
      ['/bin/claude', [], '/home/ana'],
    ]);
    // The folder the plugin is told is the one the program was spawned in (ADR 0182, note of
    // 2026-11-09): a plugin hands it to its agent as ACP's `cwd`.
    expect([inFolder.cwd, atHome.cwd]).toEqual(['/work', '/home/ana']);
    expect(test.spawned[0]?.options.env).toEqual({
      PATH: '/bin',
      SystemRoot: 'C:\\Windows',
      TYTO_WINDOW: '99',
    });
    expect(test.spawned[0]?.options.detached).toBe(true);
  });

  it('starts a .cmd through cmd.exe, and refuses an argument it cannot carry', async () => {
    const test = host({
      platform: 'win32',
      place: { folder: 'C:\\work', trust: 'trusted' },
      exists: files('\\bin\\claude.cmd'),
    });
    await test.programs.startProcess('agente', 'claude', ['--acp'], test.quiet);
    expect(test.spawned[0]).toMatchObject({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '""\\bin\\claude.cmd" --acp"'],
      options: { windowsVerbatimArguments: true, cwd: 'C:\\work' },
    });
    expect(
      await codeOf(test.programs.startProcess('agente', 'claude', ['{"a":1}'], test.quiet)),
    ).toBe('E_PROCESS_ARGUMENT');
    expect(test.spawned).toHaveLength(1);
  });

  it('ends what runs for a folder or a trust no longer open, and keeps the rest', async () => {
    const test = host();
    await test.programs.startProcess('agente', 'claude', [], test.quiet);
    test.programs.settle();
    expect(test.killed).toEqual([]);

    test.place.value = { folder: '/work', trust: 'revoked' };
    test.programs.settle();
    expect(test.killed).toEqual([1]);

    await test.programs.startProcess('agente', 'claude', [], test.quiet);
    test.place.value = { folder: '/other', trust: 'revoked' };
    test.programs.settle();
    expect(test.killed).toEqual([1, 2]);
    expect(test.waited).toEqual([false, false]);
  });

  it('ends everything on stopAll, and forgets a program that ended on its own', async () => {
    const test = host();
    const exits: ProcessExit[] = [];
    await test.programs.startProcess('agente', 'claude', [], {
      ...test.quiet,
      exit: (exit) => exits.push(exit),
    });
    await test.programs.startProcess('agente', 'claude', [], test.quiet);
    test.children[0]?.emit('close', 0, null);
    test.programs.stopAll();
    expect(exits).toEqual([{ code: 0, signal: null }]);
    expect(test.killed).toEqual([2]);
    expect(test.waited).toEqual([true]);
  });
});

describe('a plugin’s own program (ADR 0184)', () => {
  /** A disk where `/plugins/agent` holds the adapter and a link that points out of the folder. */
  const disk: PluginScripts = {
    node: '/opt/tyto/node/node',
    folderOf: (plugin) => (plugin === 'agent' ? '/plugins/agent' : undefined),
    realpath: (path) => {
      const links: Record<string, string> = {
        '/plugins/agent': '/plugins/agent',
        '/plugins/agent/adapter': '/plugins/agent/adapter',
        '/plugins/agent/adapter/claude-agent-acp.mjs':
          '/plugins/agent/adapter/claude-agent-acp.mjs',
        '/plugins/agent/escape.mjs': '/home/ana/elsewhere.mjs',
      };
      const real = links[path];
      if (real === undefined) throw new Error(`ENOENT: ${path}`);
      return real;
    },
    isFile: (path) => path.endsWith('.mjs'),
  };
  const ADAPTER = 'adapter/claude-agent-acp.mjs';

  it('runs the script on the bundled Node, with no shell, and never looks on PATH', async () => {
    const test = host({ scripts: disk, exists: files() });
    const started = await test.programs.startProcess(
      'agent',
      'claude-agent-acp',
      ['--acp'],
      test.quiet,
      ADAPTER,
    );
    expect(test.spawned[0]).toMatchObject({
      file: '/opt/tyto/node/node',
      args: ['/plugins/agent/adapter/claude-agent-acp.mjs', '--acp'],
      options: { cwd: '/work', detached: true, env: { PATH: '/bin', TYTO_WINDOW: '99' } },
    });
    expect(started.cwd).toBe('/work');
    expect(test.looked).toEqual([]);
  });

  it('answers E_PROCESS_SCRIPT_MISSING for a missing file, a link out, a folder, or no Node', async () => {
    const missing = async (
      plugin: string,
      script: string,
      scripts: PluginScripts | 'none' = disk,
    ): Promise<string> => {
      const test = host(scripts === 'none' ? {} : { scripts });
      const code = await codeOf(
        test.programs.startProcess(plugin, 'claude-agent-acp', [], test.quiet, script),
      );
      expect(test.spawned).toEqual([]);
      return code;
    };
    expect(await missing('agent', 'adapter/gone.mjs')).toBe('E_PROCESS_SCRIPT_MISSING');
    expect(await missing('agent', 'escape.mjs')).toBe('E_PROCESS_SCRIPT_MISSING');
    expect(await missing('agent', 'adapter')).toBe('E_PROCESS_SCRIPT_MISSING');
    expect(await missing('built-in', ADAPTER)).toBe('E_PROCESS_SCRIPT_MISSING');
    expect(await missing('agent', ADAPTER, 'none')).toBe('E_PROCESS_SCRIPT_MISSING');
  });

  it('refuses a restricted folder before it looks for the script', async () => {
    let asked = 0;
    const test = host({
      place: { folder: '/work', trust: 'restricted' },
      scripts: {
        ...disk,
        folderOf: (plugin) => {
          asked += 1;
          return disk.folderOf(plugin);
        },
      },
    });
    expect(
      await codeOf(
        test.programs.startProcess('agent', 'claude-agent-acp', [], test.quiet, ADAPTER),
      ),
    ).toBe('E_PROCESS_RESTRICTED');
    expect(asked).toBe(0);
  });

  it('keeps a real link out of the folder out, on this disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'tyto-plugin-script-'));
    try {
      const folder = join(root, 'agent');
      mkdirSync(join(folder, 'adapter'), { recursive: true });
      writeFileSync(join(folder, 'adapter', 'run.mjs'), '');
      writeFileSync(join(root, 'outside.mjs'), '');
      const real: PluginScripts = {
        node: process.execPath,
        folderOf: () => folder,
        realpath: (path) => realpathSync(path),
        isFile: (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false,
      };
      expect(pluginScriptFile(process.platform, real, 'agent', 'adapter/run.mjs')).toBe(
        realpathSync(join(folder, 'adapter', 'run.mjs')),
      );
      let linked = true;
      try {
        symlinkSync(join(root, 'outside.mjs'), join(folder, 'link.mjs'), 'file');
      } catch {
        // Windows without the privilege to make a link: the fake disk above covers the rule.
        linked = false;
      }
      if (linked) {
        expect(pluginScriptFile(process.platform, real, 'agent', 'link.mjs')).toBeUndefined();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hands a terminal the same file, and checks a .cmd’s arguments as cmd.exe reads them', () => {
    const test = host({ scripts: disk });
    expect(
      test.programs.terminalLaunch(
        'agent',
        'claude-agent-acp',
        ['--cli', 'auth', 'login'],
        ADAPTER,
      ),
    ).toEqual({
      file: '/opt/tyto/node/node',
      args: ['/plugins/agent/adapter/claude-agent-acp.mjs', '--cli', 'auth', 'login'],
      cwd: '/work',
      env: { PATH: '/bin', SystemRoot: 'C:\\Windows', TYTO_WINDOW: '99' },
    });
    const windows = host({
      platform: 'win32',
      place: { folder: 'C:\\work', trust: 'trusted' },
      exists: files('\\bin\\claude.cmd'),
    });
    expect(windows.programs.terminalLaunch('agente', 'claude', ['auth', 'login'])).toMatchObject({
      file: '\\bin\\claude.cmd',
      args: ['auth', 'login'],
    });
    let code = '';
    try {
      windows.programs.terminalLaunch('agente', 'claude', ['a&b']);
    } catch (cause) {
      code = cause instanceof PluginCapabilityError ? cause.code : String(cause);
    }
    expect(code).toBe('E_PROCESS_ARGUMENT');
  });
});

describe('the plugin’s data folder (ADR 0187)', () => {
  const disk: PluginScripts = {
    node: '/opt/tyto/node/node',
    folderOf: (plugin) => (plugin === 'agent' ? '/plugins/agent' : undefined),
    realpath: (path) => path,
    isFile: (path) => path === '/plugins/agent/adapter/launch.mjs',
  };
  /** A data folder per plugin, and every plugin it was asked for. */
  const folders = () => {
    const asked: string[] = [];
    return {
      asked,
      dataFolderOf: (plugin: string) => {
        asked.push(plugin);
        return `/tyto/data/plugins/${plugin}`;
      },
    };
  };

  it('names it to a program from PATH, a plugin’s own program and a terminal tab', async () => {
    const data = folders();
    const test = host({ scripts: disk, dataFolderOf: data.dataFolderOf });
    await test.programs.startProcess('agente', 'claude', [], test.quiet);
    await test.programs.startProcess(
      'agent',
      'claude-agent-acp',
      [],
      test.quiet,
      'adapter/launch.mjs',
    );
    const tab = test.programs.terminalLaunch(
      'agent',
      'claude-agent-acp',
      ['--cli'],
      'adapter/launch.mjs',
    );
    expect(test.spawned.map(({ options }) => options.env['TYTO_PROGRAM_DATA'])).toEqual([
      '/tyto/data/plugins/agente',
      '/tyto/data/plugins/agent',
    ]);
    expect(tab.env['TYTO_PROGRAM_DATA']).toBe('/tyto/data/plugins/agent');
    expect(data.asked).toEqual(['agente', 'agent', 'agent']);
  });

  it('creates nothing for a start it refuses', async () => {
    const data = folders();
    const restricted = host({
      place: { folder: '/work', trust: 'restricted' },
      scripts: disk,
      dataFolderOf: data.dataFolderOf,
    });
    const nowhere = host({ exists: files(), scripts: disk, dataFolderOf: data.dataFolderOf });
    expect(
      await codeOf(restricted.programs.startProcess('agente', 'claude', [], restricted.quiet)),
    ).toBe('E_PROCESS_RESTRICTED');
    expect(await codeOf(nowhere.programs.startProcess('agente', 'claude', [], nowhere.quiet))).toBe(
      'E_PROCESS_NOT_FOUND',
    );
    expect(
      await codeOf(
        nowhere.programs.startProcess('agent', 'claude-agent-acp', [], nowhere.quiet, 'gone.mjs'),
      ),
    ).toBe('E_PROCESS_SCRIPT_MISSING');
    expect(data.asked).toEqual([]);
  });

  it('is the host’s value, never one from main’s environment', async () => {
    const forged = { PATH: '/bin', TYTO_PROGRAM_DATA: '/somewhere/else', TYTO_WINDOW: '1' };
    const without = host({ environment: forged });
    await without.programs.startProcess('agente', 'claude', [], without.quiet);
    expect(without.spawned[0]?.options.env).toEqual({ PATH: '/bin', TYTO_WINDOW: '99' });

    const data = folders();
    const withFolder = host({ environment: forged, dataFolderOf: data.dataFolderOf });
    await withFolder.programs.startProcess('agente', 'claude', [], withFolder.quiet);
    expect(withFolder.spawned[0]?.options.env).toEqual({
      PATH: '/bin',
      TYTO_WINDOW: '99',
      TYTO_PROGRAM_DATA: '/tyto/data/plugins/agente',
    });
  });
});

describe('killProgramTree', () => {
  it('runs taskkill /T on Windows, and signals the group elsewhere', () => {
    const ran: string[] = [];
    const signalled: number[] = [];
    const how = {
      run: (file: string, args: readonly string[]) => ran.push([file, ...args].join(' ')),
      signalGroup: (pid: number) => signalled.push(pid),
    };
    killProgramTree('win32', { pid: 12 }, how);
    killProgramTree('linux', { pid: 34 }, how);
    killProgramTree('linux', { pid: undefined }, how);
    expect(ran).toEqual(['taskkill /pid 12 /T /F']);
    expect(signalled).toEqual([34]);
    expect(() =>
      killProgramTree(
        'darwin',
        { pid: 5 },
        {
          ...how,
          signalGroup: () => {
            throw new Error('ESRCH');
          },
        },
      ),
    ).not.toThrow();
  });
});

describe('a real program', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'tyto-plugin-programs-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  /** `tyto-echo`, under a folder with a space: a `.cmd` on Windows, as npm writes one. */
  function standIn(): string {
    const folder = join(scratch, 'npm global');
    mkdirSync(folder, { recursive: true });
    const script = join(folder, 'echo.mjs');
    writeFileSync(
      script,
      `process.stdout.write('ARGS ' + JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write('SECRET ' + (process.env.ANTHROPIC_API_KEY ?? 'absent') + '\\n');
process.stdin.on('data', (chunk) => process.stdout.write(chunk.toString().toUpperCase()));
`,
    );
    if (process.platform === 'win32') {
      writeFileSync(join(folder, 'tyto-echo.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      const file = join(folder, 'tyto-echo');
      writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      chmodSync(file, 0o755);
    }
    return folder;
  }

  it('talks to it both ways, with its arguments whole and no secret in its environment', async () => {
    const folder = standIn();
    const programs = pluginPrograms({
      platform: process.platform,
      environment: () => ({
        ...process.env,
        PATH: `${folder}${delimiter}${process.env['PATH'] ?? process.env['Path'] ?? ''}`,
        Path: undefined,
        ANTHROPIC_API_KEY: 'sk-ant-must-not-arrive',
      }),
      exists: existsSync,
      workspace: () => ({ folder: scratch, trust: 'trusted' }),
      home: scratch,
      windowPid: process.pid,
      spawn: (file, args, options) =>
        spawn(file, [...args], { ...options, stdio: [...options.stdio] }),
      killTree: (child) =>
        killProgramTree(process.platform, child, {
          run: (file, args) => {
            spawn(file, [...args], { stdio: 'ignore', windowsHide: true });
          },
          signalGroup: (pid) => process.kill(-pid, 'SIGTERM'),
        }),
    });
    let heard = '';
    let ended: (exit: ProcessExit) => void = () => undefined;
    const exited = new Promise<ProcessExit>((resolve) => {
      ended = resolve;
    });
    const started = await programs.startProcess('teste', 'tyto-echo', ['two words', '--acp'], {
      stdout: (bytes) => {
        heard += Buffer.from(bytes).toString('utf8');
      },
      stderr: () => undefined,
      exit: (exit) => ended(exit),
    });
    await started.write(new TextEncoder().encode('olá\n'));
    const waitedSince = Date.now();
    while (!heard.includes('OLÁ') && Date.now() - waitedSince < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await started.end();
    const exit = await exited;

    expect(heard).toContain('ARGS ["two words","--acp"]\n');
    expect(heard).toContain('SECRET absent\n');
    expect(heard).toContain('OLÁ\n');
    expect(exit.code).toBe(0);
  }, 20_000);
});
