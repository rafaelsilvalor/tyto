import { describe, expect, it } from 'vitest';

import { type HostCapabilities, PluginCapabilityError } from './capabilities.js';
import { createPluginHost } from './host.js';
import { validatePluginManifest } from './manifest.js';
import {
  PLUGIN_PROCESS_LIMIT,
  PROCESS_UNREAD_LIMIT_BYTES,
  PROCESS_WRITE_LIMIT_BYTES,
  type ProcessEvents,
  allowsProcess,
  checkedProcesses,
  processChannel,
} from './process.js';

/**
 * A program the host starts for a plugin, by name (ADR 0182): the checks that read no disk.
 * The adapter that finds the program and starts it is the desktop's, tested there.
 */

const { TextEncoder, TextDecoder, setTimeout } = globalThis as unknown as {
  setTimeout(callback: () => void, delay: number): unknown;
  TextEncoder: new () => { encode(text: string): Uint8Array };
  TextDecoder: new () => { decode(bytes: Uint8Array): string };
};
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

interface Started {
  readonly program: string;
  readonly args: readonly string[];
  readonly events: ProcessEvents;
  readonly written: string[];
  killed: number;
}

/**
 * A port whose programs echo stdin back upper-cased, end with 0 when stdin closes, and end
 * by signal when killed. `hold` keeps a start unanswered until the test lets it go.
 */
function programs(options: { readonly hold?: boolean; readonly cwd?: unknown } = {}) {
  const started: Started[] = [];
  const holding: (() => void)[] = [];
  const capabilities: HostCapabilities = {
    fetch: () => Promise.reject(new Error('no network here')),
    credential: () => Promise.resolve(undefined),
    describeCredential: () => 'nowhere',
    hostName: 'the test host',
    startProcess: async (_plugin, program, args, events) => {
      const record: Started = { program, args, events, written: [], killed: 0 };
      started.push(record);
      if (options.hold === true) await new Promise<void>((go) => holding.push(go));
      return {
        cwd: ('cwd' in options ? options.cwd : '/home/ana/work') as string,
        write: (bytes) => {
          record.written.push(text(bytes));
          events.stdout(new TextEncoder().encode(text(bytes).toUpperCase()));
          return Promise.resolve();
        },
        end: () => {
          events.exit({ code: 0, signal: null });
          return Promise.resolve();
        },
        kill: () => {
          record.killed += 1;
          events.exit({ code: null, signal: 'SIGTERM' });
        },
      };
    },
  };
  return { capabilities, started, release: () => holding.splice(0).forEach((go) => go()) };
}

const silent = (): ProcessEvents => ({
  stdout: () => undefined,
  stderr: () => undefined,
  exit: () => undefined,
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (cause) {
    return cause instanceof PluginCapabilityError ? cause.code : String(cause);
  }
}

const manifest = (permissions: readonly string[]) => ({
  name: 'agente',
  version: '1.0.0',
  engine: '>=0.1',
  contributes: ['panel'],
  permissions,
});

describe('process:<name> in the manifest', () => {
  it('accepts one program by its bare name', () => {
    for (const name of ['claude', 'claude-code-acp', 'gemini', 'node22', 'a.b_c']) {
      expect(validatePluginManifest(manifest([`process:${name}`])).ok, name).toBe(true);
    }
  });

  it('refuses a path, a wildcard, upper case, an extension and an empty name', () => {
    const cases: Record<string, string> = {
      'process:/usr/bin/claude': 'is a path',
      'process:C:\\bin\\claude': 'is a path',
      'process:*': 'has a wildcard',
      'process:claude*': 'has a wildcard',
      'process:Claude': 'is not 1 to 64 lowercase',
      'process:': 'is not 1 to 64 lowercase',
      'process:claude.cmd': 'ends in an extension',
      'process:claude.exe': 'ends in an extension',
      'process:install.ps1': 'ends in an extension',
    };
    for (const [permission, problem] of Object.entries(cases)) {
      const result = validatePluginManifest(manifest([permission]));
      expect(result.ok, permission).toBe(false);
      if (!result.ok) expect(result.error[0]?.message, permission).toContain(problem);
    }
  });

  it('matches the name exactly: claude does not start claude-code', () => {
    expect(allowsProcess(['process:claude'], 'claude')).toBe(true);
    expect(allowsProcess(['process:claude'], 'claude-code')).toBe(false);
    expect(allowsProcess(['process:claude'], 'CLAUDE')).toBe(false);
    expect(allowsProcess(['process:*'], 'claude')).toBe(false);
  });
});

describe('checkedProcesses', () => {
  it('refuses an undeclared program before the adapter hears of it', async () => {
    const port = programs();
    const checked = checkedProcesses('agente', ['process:claude'], port.capabilities);

    expect(await codeOf(checked.start('codex', [], silent()))).toBe('E_PERMISSION');
    expect(port.started).toEqual([]);
  });

  it('answers E_PROCESS_UNAVAILABLE on a host with no port, as the CLI', async () => {
    const { startProcess: _port, ...cli } = programs().capabilities;
    const checked = checkedProcesses('agente', ['process:claude'], cli);

    const refusal = await checked.start('claude', [], silent()).catch((cause: unknown) => cause);
    expect(refusal).toBeInstanceOf(PluginCapabilityError);
    expect((refusal as PluginCapabilityError).message).toBe(
      "Plugin 'agente' asked to start 'claude', and the test host starts no programs.",
    );
  });

  it('passes the arguments as an array, and refuses anything that is not strings', async () => {
    const port = programs();
    const checked = checkedProcesses('agente', ['process:claude'], port.capabilities);

    await checked.start('claude', ['--acp', 'a b'], silent());
    expect(port.started[0]?.args).toEqual(['--acp', 'a b']);
    await expect(checked.start('claude', [1 as unknown as string], silent())).rejects.toThrow(
      TypeError,
    );
  });

  it(`keeps at most ${String(PLUGIN_PROCESS_LIMIT)} running, and frees a slot when one ends`, async () => {
    const port = programs();
    const checked = checkedProcesses('agente', ['process:claude'], port.capabilities);

    const first = await checked.start('claude', [], silent());
    await checked.start('claude', [], silent());
    expect(await codeOf(checked.start('claude', [], silent()))).toBe('E_PROCESS_LIMIT');

    await first.end();
    expect(await codeOf(checked.start('claude', [], silent()))).toBe('resolved');
    expect(port.started).toHaveLength(3);
  });

  it('counts a start the adapter has not answered yet against the limit', async () => {
    const port = programs({ hold: true });
    const checked = checkedProcesses('agente', ['process:claude'], port.capabilities);

    const pending = [checked.start('claude', [], silent()), checked.start('claude', [], silent())];
    expect(await codeOf(checked.start('claude', [], silent()))).toBe('E_PROCESS_LIMIT');
    port.release();
    await Promise.all(pending);
  });

  it('refuses a write after the program ended, and one over the ceiling', async () => {
    const port = programs();
    const checked = checkedProcesses('agente', ['process:claude'], port.capabilities);
    const program = await checked.start('claude', [], silent());

    await expect(program.write(new Uint8Array(PROCESS_WRITE_LIMIT_BYTES + 1))).rejects.toThrow(
      RangeError,
    );
    await program.end();
    expect(await codeOf(program.write(new TextEncoder().encode('tarde')))).toBe('E_PROCESS_EXITED');
  });

  it('ends every running program, and one still starting, on stopAll', async () => {
    const port = programs({ hold: true });
    const checked = checkedProcesses('agente', ['process:claude'], port.capabilities);

    const starting = checked.start('claude', [], silent());
    checked.stopAll();
    port.release();
    await starting;
    expect(port.started.map((program) => program.killed)).toEqual([1]);
  });
});

describe('the folder a program runs in (ADR 0182, note of 2026-11-09)', () => {
  it('hands the plugin the folder the adapter started it in', async () => {
    const port = programs({ cwd: '/home/ana/work' });
    const checked = checkedProcesses('agente', ['process:claude'], port.capabilities);
    const program = await checked.start('claude', [], silent());
    const channel = processChannel();
    expect(program.cwd).toBe('/home/ana/work');
    expect(channel.handle(program).cwd).toBe('/home/ana/work');
  });

  it('refuses, and ends, a program whose adapter does not say where it runs', async () => {
    const answers: string[] = [];
    const killed: number[] = [];
    for (const cwd of ['', undefined, 42]) {
      const port = programs({ cwd });
      const checked = checkedProcesses('agente', ['process:claude'], port.capabilities);
      answers.push(await codeOf(checked.start('claude', [], silent())));
      killed.push(port.started[0]?.killed ?? -1);
    }
    expect(answers).toEqual(
      Array(3).fill(
        "TypeError: the test host started 'claude' without saying the folder it runs in.",
      ),
    );
    // Ended rather than left running where the plugin can no longer reach it.
    expect(killed).toEqual([1, 1, 1]);
  });
});

describe('processChannel', () => {
  it('hands chunks that came before the first listener to it, up to the ceiling', () => {
    const channel = processChannel();
    channel.events.stdout(new TextEncoder().encode('cedo'));
    channel.events.stderr(new Uint8Array(PROCESS_UNREAD_LIMIT_BYTES + 1));
    const handle = channel.handle({
      cwd: '/home/ana/work',
      write: () => Promise.resolve(),
      end: () => Promise.resolve(),
      kill: () => Promise.resolve(),
    });

    const out: string[] = [];
    const err: number[] = [];
    handle.onStdout((bytes) => out.push(text(bytes)));
    handle.onStderr((bytes) => err.push(bytes.length));
    channel.events.stdout(new TextEncoder().encode('depois'));

    expect(out).toEqual(['cedo', 'depois']);
    expect(err).toEqual([]);
  });
});

describe('host.process in process', () => {
  it('talks to a program both ways, and disposePlugin ends what it started', async () => {
    const port = programs();
    const host = createPluginHost({ capabilities: port.capabilities });
    let answer = '';
    host.activate(
      {
        id: 'agente',
        manifest: manifest(['process:claude']),
        activate: (plugin) => {
          void (async () => {
            const program = await plugin.process.start('claude', ['--acp']);
            program.onStdout((bytes) => {
              answer += text(bytes);
            });
            await program.write('olá');
          })();
        },
      },
      'external',
    );
    await new Promise<void>((settle) => setTimeout(settle, 0));

    expect(answer).toBe('OLÁ');
    expect(port.started[0]?.killed).toBe(0);
    host.disposePlugin('agente');
    expect(port.started[0]?.killed).toBe(1);
  });
});
