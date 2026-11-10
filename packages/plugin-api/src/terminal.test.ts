import { diagnostic } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type HostCapabilities, PluginCapabilityError } from './capabilities.js';
import { createPluginHost } from './host.js';
import { checkedProcesses } from './process.js';
import { type OpenedTerminal, PLUGIN_TERMINAL_LIMIT, checkedTerminal } from './terminal.js';

/**
 * A terminal tab for a plugin's declared program, and a plugin's own program (ADR 0184): the
 * checks on the host's side. Opening the tab and running the script on the bundled Node are the
 * desktop's, tested there.
 */

const BASE: HostCapabilities = {
  hostName: 'the desktop',
  fetch: () => Promise.reject(new Error('no network here')),
  credential: () => Promise.resolve(undefined),
  describeCredential: () => 'nowhere',
};

interface Asked {
  readonly program: string;
  readonly args: readonly string[];
  readonly script: string | undefined;
}

/** A port that records what it was asked and keeps each tab open until `close` is called. */
function terminals(): {
  readonly capabilities: HostCapabilities;
  readonly asked: Asked[];
  close(): void;
} {
  const asked: Asked[] = [];
  const closers: (() => void)[] = [];
  return {
    asked,
    capabilities: {
      ...BASE,
      openTerminal: (_plugin, program, args, script) => {
        asked.push({ program, args, script });
        const closed = new Promise<void>((resolve) => closers.push(resolve));
        return Promise.resolve({ closed });
      },
    },
    close: () => closers.shift()?.(),
  };
}

const codeOf = (attempt: Promise<unknown>): Promise<string> =>
  attempt.then(
    () => 'opened',
    (cause: unknown) =>
      cause instanceof PluginCapabilityError ? cause.code : `thrown: ${String(cause)}`,
  );

const { setTimeout } = globalThis as unknown as {
  setTimeout(callback: () => void, delay: number): unknown;
};

/** Lets the `closed` handler run, which is a microtask after the port settles it. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('who may open a terminal', () => {
  it('is a plugin that declares the program, by its exact name', async () => {
    const port = terminals();
    const open = checkedTerminal('agente', ['process:claude-agent-acp'], port.capabilities);
    expect(await codeOf(open('claude', ['auth', 'login']))).toBe('E_PERMISSION');
    expect(await codeOf(open('claude-agent-acp', ['--cli', 'auth', 'login']))).toBe('opened');
    expect(port.asked).toEqual([
      { program: 'claude-agent-acp', args: ['--cli', 'auth', 'login'], script: undefined },
    ]);
  });

  it('answers E_TERMINAL_UNAVAILABLE on a host with no terminal, naming the host', async () => {
    const open = checkedTerminal('agente', ['process:claude'], { ...BASE, hostName: 'tyto' });
    const refused = await open('claude', []).catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(PluginCapabilityError);
    expect((refused as PluginCapabilityError).diagnostic.message).toContain('tyto has no terminal');
  });

  it('hands the adapter’s own refusals on as they are', async () => {
    const open = checkedTerminal('agente', ['process:claude'], {
      ...BASE,
      openTerminal: () =>
        Promise.reject(
          new PluginCapabilityError(
            diagnostic('E_PROCESS_RESTRICTED', { plugin: 'agente', program: 'claude' }),
          ),
        ),
    });
    expect(await codeOf(open('claude', []))).toBe('E_PROCESS_RESTRICTED');
  });
});

describe('how many terminals a plugin keeps open', () => {
  it(`is ${String(PLUGIN_TERMINAL_LIMIT)}: a second ask waits for the first tab to close`, async () => {
    const port = terminals();
    const open = checkedTerminal('agente', ['process:claude'], port.capabilities);
    expect(await codeOf(open('claude', []))).toBe('opened');
    expect(await codeOf(open('claude', []))).toBe('E_TERMINAL_LIMIT');
    port.close();
    await settled();
    expect(await codeOf(open('claude', []))).toBe('opened');
    expect(port.asked).toHaveLength(2);
  });

  it('counts from the ask, so two at once cannot both pass', async () => {
    const port = terminals();
    const open = checkedTerminal('agente', ['process:claude'], port.capabilities);
    const answers = await Promise.all([codeOf(open('claude', [])), codeOf(open('claude', []))]);
    expect(answers.sort()).toEqual(['E_TERMINAL_LIMIT', 'opened']);
  });

  it('frees the slot when the adapter refuses, so a failed open costs nothing', async () => {
    let refuse = true;
    const open = checkedTerminal('agente', ['process:claude'], {
      ...BASE,
      openTerminal: () =>
        refuse
          ? Promise.reject(new Error('no pty'))
          : Promise.resolve({ closed: new Promise<void>(() => undefined) }),
    });
    expect(await codeOf(open('claude', []))).toBe('thrown: Error: no pty');
    refuse = false;
    expect(await codeOf(open('claude', []))).toBe('opened');
  });

  it('refuses an adapter that never says when the tab closes, rather than holding the slot', async () => {
    const open = checkedTerminal('agente', ['process:claude'], {
      ...BASE,
      openTerminal: () => Promise.resolve({} as OpenedTerminal),
    });
    expect(await codeOf(open('claude', []))).toContain('without saying when it closes');
    expect(await codeOf(open('claude', []))).toContain('without saying when it closes');
  });
});

describe('a plugin’s own program', () => {
  it('reaches the adapter with the script the manifest names, for a terminal and a start', async () => {
    const port = terminals();
    const scripts = { 'claude-agent-acp': 'adapter/claude-agent-acp.mjs' };
    const open = checkedTerminal(
      'agente',
      ['process:claude-agent-acp'],
      port.capabilities,
      scripts,
    );
    await open('claude-agent-acp', ['--cli']);
    expect(port.asked[0]?.script).toBe('adapter/claude-agent-acp.mjs');

    const started: (string | undefined)[] = [];
    const processes = checkedProcesses(
      'agente',
      ['process:claude-agent-acp', 'process:claude'],
      {
        ...BASE,
        startProcess: (_plugin, _program, _args, _events, script) => {
          started.push(script);
          return Promise.resolve({
            cwd: '/home/ana',
            write: () => Promise.resolve(),
            end: () => Promise.resolve(),
            kill: () => undefined,
          });
        },
      },
      scripts,
    );
    const events = { stdout: () => undefined, stderr: () => undefined, exit: () => undefined };
    await processes.start('claude-agent-acp', [], events);
    await processes.start('claude', [], events);
    expect(started).toEqual(['adapter/claude-agent-acp.mjs', undefined]);
  });

  it('never reads a script off an inherited key', async () => {
    const port = terminals();
    const open = checkedTerminal('agente', ['process:constructor'], port.capabilities, {});
    await open('constructor', []);
    expect(port.asked[0]?.script).toBeUndefined();
  });
});

describe('host.terminal in process', () => {
  it('opens through the same check, with the manifest’s programs', async () => {
    const port = terminals();
    const host = createPluginHost({ capabilities: port.capabilities });
    let opened: Promise<void> = Promise.resolve();
    host.activate({
      id: 'agente',
      manifest: {
        name: 'agente',
        version: '1.0.0',
        engine: '>=0.1',
        contributes: ['panel'],
        permissions: ['process:claude-agent-acp'],
        programs: { 'claude-agent-acp': 'adapter/claude-agent-acp.mjs' },
      },
      activate: (plugin) => {
        opened = plugin.terminal.open('claude-agent-acp', ['--cli', 'auth', 'login']);
      },
    });
    await opened;
    expect(port.asked).toEqual([
      {
        program: 'claude-agent-acp',
        args: ['--cli', 'auth', 'login'],
        script: 'adapter/claude-agent-acp.mjs',
      },
    ]);
  });
});
