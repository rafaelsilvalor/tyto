import { diagnostic } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type HostCapabilities, PluginCapabilityError } from './capabilities.js';
import { createPluginHost } from './host.js';
import {
  type AgentServer,
  WINDOW_AGENT_SERVER_NAME,
  checkedWindowAgentServer,
  namesAProgram,
} from './window.js';

/**
 * The window's agent server, handed to a plugin for the program it starts (ADR 0183): the
 * checks on the host's side. The adapter that reads `agentsListen` and the folder's trust is the
 * desktop's, tested there.
 */

const SERVER: AgentServer = {
  name: WINDOW_AGENT_SERVER_NAME,
  command: '/opt/tyto/node/node',
  args: ['/opt/tyto/relay/agent-relay.js'],
  env: [
    { name: 'TYTO_WINDOW', value: '4242' },
    { name: 'TYTO_HOME', value: '/home/ana/.tyto' },
  ],
};

const BASE: HostCapabilities = {
  hostName: 'the desktop',
  fetch: () => Promise.reject(new Error('no network here')),
  credential: () => Promise.resolve(undefined),
  describeCredential: () => 'nowhere',
};

const withServer = (answer: () => Promise<unknown>): HostCapabilities => ({
  ...BASE,
  windowAgentServer: answer as () => Promise<AgentServer>,
});

const codeOf = (attempt: Promise<unknown>): Promise<string> =>
  attempt.then(
    () => 'answered',
    (cause: unknown) =>
      cause instanceof PluginCapabilityError ? cause.code : `thrown: ${String(cause)}`,
  );

describe('who may ask for the window’s agent server', () => {
  it('is a plugin that declares a program, and no other', () => {
    expect(namesAProgram(['process:claude-agent-acp'])).toBe(true);
    expect(namesAProgram(['net:example.com', 'process:gemini'])).toBe(true);
    expect(namesAProgram([])).toBe(false);
    expect(namesAProgram(['net:example.com', 'workspace:read', 'credentials:token'])).toBe(false);
    // A permission the manifest would refuse never counts, whatever reached this far.
    expect(namesAProgram(['process:', 'process:claude.exe', 'process:C:/bin/claude'])).toBe(false);
  });

  it('refuses a plugin with no process: permission before the adapter is asked', async () => {
    let asked = 0;
    const capabilities = withServer(() => {
      asked += 1;
      return Promise.resolve(SERVER);
    });
    const refusal = await checkedWindowAgentServer(
      'agente',
      ['workspace:read'],
      capabilities,
    )().then(
      () => undefined,
      (cause: PluginCapabilityError) => cause,
    );
    expect(refusal?.code).toBe('E_PERMISSION');
    expect(refusal?.message).toContain('host.window.agentServer() (a process:<name> permission)');
    expect(asked).toBe(0);
  });
});

describe('what the window’s agent server answers', () => {
  it('is the adapter’s server, in ACP’s mcpServers shape', async () => {
    const answer = await checkedWindowAgentServer(
      'agente',
      ['process:claude-agent-acp'],
      withServer(() => Promise.resolve(SERVER)),
    )();
    expect(answer).toEqual(SERVER);
  });

  it('answers E_WINDOW_UNAVAILABLE on a host with no window, naming the host', async () => {
    const refusal = await checkedWindowAgentServer('agente', ['process:claude'], {
      ...BASE,
      hostName: 'tyto',
    })().then(
      () => undefined,
      (cause: PluginCapabilityError) => cause,
    );
    expect(refusal?.code).toBe('E_WINDOW_UNAVAILABLE');
    expect(refusal?.message).toBe(
      "Plugin 'agente' asked for the window's agent server, and tyto has no window.",
    );
  });

  it('hands the adapter’s own refusals on as they are', async () => {
    const codes = await Promise.all(
      (['E_WINDOW_AGENTS_OFF', 'E_WINDOW_RESTRICTED'] as const).map((code) =>
        codeOf(
          checkedWindowAgentServer(
            'agente',
            ['process:claude'],
            withServer(() =>
              Promise.reject(new PluginCapabilityError(diagnostic(code, { plugin: 'agente' }))),
            ),
          )(),
        ),
      ),
    );
    expect(codes).toEqual(['E_WINDOW_AGENTS_OFF', 'E_WINDOW_RESTRICTED']);
  });

  it('never lets a variable other than TYTO_WINDOW and TYTO_HOME cross, a secret least of all', async () => {
    const answers = await Promise.all(
      ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'PATH', 'tyto_window'].map((name) =>
        codeOf(
          checkedWindowAgentServer(
            'agente',
            ['process:claude'],
            withServer(() =>
              Promise.resolve({ ...SERVER, env: [...SERVER.env, { name, value: 'x' }] }),
            ),
          )(),
        ),
      ),
    );
    for (const answer of answers) {
      expect(answer).toMatch(
        /^thrown: TypeError: the desktop put .+ which carries only TYTO_WINDOW and TYTO_HOME/u,
      );
    }
  });

  it('refuses an answer of another shape, so an adapter’s extra field never reaches a plugin', async () => {
    const answers = await Promise.all(
      [{ ...SERVER, token: 'secret' }, { ...SERVER, args: 'relay.js' }, undefined].map((answer) =>
        codeOf(
          checkedWindowAgentServer(
            'agente',
            ['process:claude'],
            withServer(() => Promise.resolve(answer)),
          )(),
        ),
      ),
    );
    expect(answers).toEqual(
      Array(3).fill(
        "thrown: TypeError: the desktop answered the window's agent server with something else.",
      ),
    );
  });
});

describe('host.window in process', () => {
  it('answers a plugin through the same check', async () => {
    const host = createPluginHost({ capabilities: withServer(() => Promise.resolve(SERVER)) });
    const answers: string[] = [];
    let done: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });
    for (const [id, permissions] of [
      ['agente', ['process:claude-agent-acp']],
      ['outro', ['net:example.com']],
    ] as const) {
      host.activate({
        id,
        manifest: {
          name: id,
          version: '1.0.0',
          engine: '>=0.1',
          contributes: ['panel'],
          permissions: [...permissions],
        },
        activate: (plugin) => {
          void plugin.window.agentServer().then(
            (server) => {
              answers.push(`${id}: ${server.name} ${server.env.map((v) => v.name).join(',')}`);
              if (answers.length === 2) done();
            },
            (cause: PluginCapabilityError) => {
              answers.push(`${id}: ${cause.code}`);
              if (answers.length === 2) done();
            },
          );
        },
      });
    }
    await finished;
    expect(answers.sort()).toEqual(['agente: tyto TYTO_WINDOW,TYTO_HOME', 'outro: E_PERMISSION']);
  });
});
