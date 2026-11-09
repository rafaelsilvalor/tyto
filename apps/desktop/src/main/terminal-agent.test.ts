import { posix, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type AgentLaunchOptions,
  agentConfigFile,
  agentLaunch,
  agentRelayPaths,
  claudeConfig,
  findProgram,
  notFound,
  unsafeValue,
} from './terminal-agent.js';

/**
 * What Open an Agent Here starts (TYTO-567, ADR 0181). Pure: each platform's rules are checked
 * on every machine, with the file check handed in.
 */

const linux = (overrides: Partial<AgentLaunchOptions> = {}): AgentLaunchOptions => ({
  platform: 'linux',
  environment: { PATH: '/usr/local/bin:/usr/bin' },
  command: 'claude',
  args: [],
  exists: (path) => path === '/usr/bin/claude' || path === '/usr/bin/codex',
  relay: { node: '/opt/Tyto/resources/node/node', script: '/opt/Tyto/relay/agent-relay.js' },
  pid: 4242,
  home: '/home/person/.tyto',
  configFile: '/home/person/.tyto/agents/window-4242.json',
  ...overrides,
});

/** The default per-user Windows install, under a user name with a space in it. */
const windows = (overrides: Partial<AgentLaunchOptions> = {}): AgentLaunchOptions => ({
  platform: 'win32',
  environment: {
    Path: 'C:\\Users\\Ana Maria\\AppData\\Roaming\\npm;C:\\Windows',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  },
  command: 'claude',
  args: [],
  exists: (path) => path === 'C:\\Users\\Ana Maria\\AppData\\Roaming\\npm\\claude.cmd',
  relay: {
    node: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\Tyto\\resources\\node\\node.exe',
    script:
      'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\Tyto\\resources\\app.asar.unpacked\\out\\relay\\agent-relay.js',
  },
  pid: 4242,
  home: 'C:\\Users\\Ana Maria\\.tyto',
  configFile: 'C:\\Users\\Ana Maria\\.tyto\\agents\\window-4242.json',
  ...overrides,
});

describe('finding the agent program', () => {
  it('looks it up on PATH, folder by folder', () => {
    expect(findProgram(linux(), 'claude')).toBe('/usr/bin/claude');
    expect(findProgram(linux(), 'nope')).toBeUndefined();
  });

  it("tries PATHEXT's extensions on Windows, where npm installs claude.cmd", () => {
    expect(findProgram(windows(), 'claude')).toBe(
      'C:\\Users\\Ana Maria\\AppData\\Roaming\\npm\\claude.cmd',
    );
  });

  it('takes a path as it is, when the file exists', () => {
    expect(findProgram(linux({ exists: (path) => path === '/x/claude' }), '/x/claude')).toBe(
      '/x/claude',
    );
    expect(findProgram(linux(), '/x/claude')).toBeUndefined();
  });
});

describe('what starts', () => {
  it('starts Claude Code with the window relay in a configuration file, and agentArgs after', () => {
    const launch = agentLaunch(linux({ args: ['--model', 'opus'] }));

    expect(launch).toEqual({
      choice: {
        file: '/usr/bin/claude',
        args: ['--mcp-config', '/home/person/.tyto/agents/window-4242.json', '--model', 'opus'],
        title: 'claude',
      },
      config: { file: '/home/person/.tyto/agents/window-4242.json', text: claudeConfig(linux()) },
    });
    expect(JSON.parse(claudeConfig(linux()))).toEqual({
      mcpServers: {
        tyto: {
          type: 'stdio',
          command: '/opt/Tyto/resources/node/node',
          args: ['/opt/Tyto/relay/agent-relay.js'],
          env: { TYTO_WINDOW: '4242', TYTO_HOME: '/home/person/.tyto' },
        },
      },
    });
  });

  it('keeps a path with spaces whole: one argument, no quotes added, the JSON parses back', () => {
    const launch = agentLaunch(windows());
    if (!('choice' in launch)) throw new Error('expected a launch');

    expect(launch.choice.file).toBe('C:\\Users\\Ana Maria\\AppData\\Roaming\\npm\\claude.cmd');
    expect(launch.choice.title).toBe('claude');
    expect(launch.choice.args).toEqual([
      '--mcp-config',
      'C:\\Users\\Ana Maria\\.tyto\\agents\\window-4242.json',
    ]);
    const server = (
      JSON.parse(launch.config?.text ?? '') as {
        mcpServers: { tyto: { command: string; args: string[] } };
      }
    ).mcpServers.tyto;
    expect(server.command).toBe(windows().relay.node);
    expect(server.args).toEqual([windows().relay.script]);
  });

  it('tells Codex through -c overrides, as TOML literal strings', () => {
    const launch = agentLaunch(linux({ command: 'codex' }));

    expect(launch).toEqual({
      choice: {
        file: '/usr/bin/codex',
        args: [
          '-c',
          "mcp_servers.tyto.command='/opt/Tyto/resources/node/node'",
          '-c',
          "mcp_servers.tyto.args=['/opt/Tyto/relay/agent-relay.js']",
          '-c',
          "mcp_servers.tyto.env={ TYTO_WINDOW = '4242', TYTO_HOME = '/home/person/.tyto' }",
        ],
        title: 'codex',
      },
    });
  });

  it('starts any other agent with its own arguments only', () => {
    const launch = agentLaunch(
      linux({ command: 'aider', args: ['--yes'], exists: (path) => path === '/usr/bin/aider' }),
    );
    expect(launch).toEqual({ choice: { file: '/usr/bin/aider', args: ['--yes'], title: 'aider' } });
  });

  it('says so when the program is not installed, and Tyto installs nothing', () => {
    expect(agentLaunch(linux({ exists: () => false }))).toEqual({ refused: notFound('claude') });
    expect(notFound('claude')).toContain('Tyto installs no agent');
  });

  it('refuses a value its command line cannot carry rather than quoting it', () => {
    const home = "/home/o'neil/.tyto";
    expect(agentLaunch(linux({ command: 'codex', home }))).toEqual({
      refused: unsafeValue(home),
    });
    const configFile = '/home/a"b/.tyto/agents/window-4242.json';
    expect(agentLaunch(linux({ configFile }))).toEqual({ refused: unsafeValue(configFile) });
  });
});

describe('where the relay and the configuration are', () => {
  it('runs from out/ in development and from the unpacked asar in a package', () => {
    expect(
      agentRelayPaths({
        packaged: false,
        mainDirectory: '/repo/apps/desktop/out/main',
        resourcesPath: '/unused',
        platform: 'linux',
        join: posix.join,
      }),
    ).toEqual({
      node: '/repo/apps/desktop/out/node/node',
      script: '/repo/apps/desktop/out/relay/agent-relay.js',
    });
    expect(
      agentRelayPaths({
        packaged: true,
        mainDirectory: 'C:\\unused',
        resourcesPath: 'C:\\Programs\\Tyto\\resources',
        platform: 'win32',
        join: win32.join,
      }),
    ).toEqual({
      node: 'C:\\Programs\\Tyto\\resources\\node\\node.exe',
      script: 'C:\\Programs\\Tyto\\resources\\app.asar.unpacked\\out\\relay\\agent-relay.js',
    });
  });

  it('keeps the configuration in TYTO_HOME, one per window, never in the workspace', () => {
    expect(agentConfigFile('/home/person/.tyto', 4242, 'linux')).toBe(
      '/home/person/.tyto/agents/window-4242.json',
    );
    expect(agentConfigFile('C:\\Users\\a\\.tyto', 7, 'win32')).toBe(
      'C:\\Users\\a\\.tyto\\agents\\window-7.json',
    );
  });
});
