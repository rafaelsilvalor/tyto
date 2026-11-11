import { posix, win32 } from 'node:path';

import { WINDOW_PID_VARIABLE } from '@tyto/command-line/relay';
import { diagnostic } from '@tyto/core';
import {
  type AgentServer,
  PluginCapabilityError,
  WINDOW_AGENT_SERVER_NAME,
} from '@tyto/plugin-api';

import { programName } from './terminal.js';
import type { ShellChoice } from './terminal-shell.js';
import type { WorkspaceState } from './workspace.js';

/**
 * What **Open an Agent Here** starts (TYTO-567, ADR 0181): the agent program the person set in
 * `agentCommand`, found on `PATH`, with the arguments that register the window's relay as an MCP
 * server for that one session.
 *
 * Pure, with the platform, the environment and the file check handed in, as `terminal-shell.ts`
 * is, so the Windows rules are tested on Linux CI and the other way round.
 *
 * **Nothing is written into the workspace.** Claude Code reads the relay from a file Tyto writes
 * in `TYTO_HOME` (`--mcp-config <file>`); Codex from `-c` overrides. A file, not the JSON inline,
 * because on Windows an agent installed by npm is a `.cmd` file, which `cmd.exe` reads again, and
 * `cmd.exe` gives the double quotes JSON is full of a meaning of its own. Every value on the
 * command line here is free of double quotes for the same reason.
 */

/** The relay an agent's MCP configuration names: the bundled Node and the script it runs. */
export interface AgentRelay {
  readonly node: string;
  readonly script: string;
}

export interface AgentLaunchOptions {
  readonly platform: NodeJS.Platform;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** `agentCommand`: a program name looked up on `PATH`, or a path to one. */
  readonly command: string;
  /** `agentArgs`: added after the ones that connect the agent to the window. */
  readonly args: readonly string[];
  readonly exists: (path: string) => boolean;
  readonly relay: AgentRelay;
  /** The window's process id: what `TYTO_WINDOW` names. */
  readonly pid: number;
  /** `TYTO_HOME`, which the relay reads the window's record from. */
  readonly home: string;
  /** Where the Claude Code configuration goes: in `TYTO_HOME`, never in the workspace. */
  readonly configFile: string;
}

export type AgentLaunch =
  | {
      readonly choice: ShellChoice;
      /** A file to write before the program starts, when the program reads one. */
      readonly config?: { readonly file: string; readonly text: string };
    }
  | { readonly refused: string };

/** The `PATHEXT` Windows reads when the variable is missing: what `cmd.exe` would try. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function variable(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  // Windows spells it `Path`, and a process environment there is case-insensitive.
  return Object.entries(environment).find(([key]) => key.toUpperCase() === name)?.[1];
}

/**
 * The program's file: a path as it is, when it exists; else the first `PATH` folder that has it,
 * trying `PATHEXT`'s extensions on Windows when the name has none (`claude` is `claude.exe` or an
 * npm `claude.cmd` there). Undefined when nothing has it.
 */
export function findProgram(
  options: Pick<AgentLaunchOptions, 'platform' | 'environment' | 'exists'>,
  command: string,
): string | undefined {
  const path = options.platform === 'win32' ? win32 : posix;
  const names =
    options.platform === 'win32' && path.extname(command) === ''
      ? [
          command,
          ...(variable(options.environment, 'PATHEXT') ?? DEFAULT_PATHEXT)
            .split(';')
            .filter((extension) => extension !== '')
            .map((extension) => `${command}${extension.toLowerCase()}`),
        ]
      : [command];
  if (command.includes('/') || (options.platform === 'win32' && command.includes('\\'))) {
    return names.find((name) => options.exists(name));
  }
  for (const folder of (variable(options.environment, 'PATH') ?? '').split(path.delimiter)) {
    if (folder === '') continue;
    for (const name of names) {
      const candidate = path.join(folder, name);
      if (options.exists(candidate)) return candidate;
    }
  }
  return undefined;
}

export function notFound(command: string): string {
  return `"${command}" was not found on PATH, so no agent started. Tyto installs no agent: install it, or set agentCommand in settings.json to the agent you use (ADR 0181).`;
}

export function unsafeValue(value: string): string {
  return `The agent could not be told where Tyto's relay is: ${value} holds a quote or a line break, which its command line cannot carry (ADR 0181).`;
}

/** What Claude Code's `--mcp-config` reads: one stdio server, `tyto`, the window's relay. */
export function claudeConfig(options: Pick<AgentLaunchOptions, 'relay' | 'pid' | 'home'>): string {
  const server = {
    type: 'stdio',
    command: options.relay.node,
    args: [options.relay.script],
    env: { [WINDOW_PID_VARIABLE]: String(options.pid), TYTO_HOME: options.home },
  };
  return `${JSON.stringify({ mcpServers: { tyto: server } }, null, 2)}\n`;
}

/**
 * The same server in the shape ACP's `session/new` takes in `mcpServers` (ADR 0183), for the
 * agent a plugin starts. The plugin sends it on the agent's stdin, inside JSON, so no command
 * line carries it and no quote rule applies. `TYTO_WINDOW` and `TYTO_HOME` only: the relay's two.
 */
export function windowAgentServer(
  options: Pick<AgentLaunchOptions, 'relay' | 'pid' | 'home'>,
): AgentServer {
  return {
    name: WINDOW_AGENT_SERVER_NAME,
    command: options.relay.node,
    args: [options.relay.script],
    env: [
      { name: WINDOW_PID_VARIABLE, value: String(options.pid) },
      { name: 'TYTO_HOME', value: options.home },
    ],
  };
}

export interface WindowAgentServerPortOptions extends Pick<
  AgentLaunchOptions,
  'relay' | 'pid' | 'home'
> {
  /** Whether the window's endpoint listens now (`agentsListen`). */
  readonly listening: () => boolean;
  readonly workspace: () => Pick<WorkspaceState, 'folder' | 'trust'>;
}

/**
 * The desktop's `windowAgentServer` port (ADR 0183). The folder's trust and `agentsListen` are
 * read on every call, because either can change between a plugin's two conversations; the
 * permission is plugin-api's to check, in front of this.
 */
export function windowAgentServerPort(
  options: WindowAgentServerPortOptions,
): (plugin: string) => Promise<AgentServer> {
  return (plugin) => {
    const refused = windowRefusal(plugin, options);
    if (refused !== undefined) return Promise.reject(refused);
    return Promise.resolve(windowAgentServer(options));
  };
}

/**
 * Why the window refuses a plugin now, or `undefined`: the same two refusals for the agent server
 * (ADR 0183 decision 4) and the window's tools called in process (ADR 0190), in this order.
 */
export function windowRefusal(
  plugin: string,
  options: Pick<WindowAgentServerPortOptions, 'listening' | 'workspace'>,
): PluginCapabilityError | undefined {
  const { folder, trust } = options.workspace();
  // As the terminal and a plugin's program are refused (ADR 0164 decision 5, ADR 0182).
  if (folder !== null && trust === 'restricted') {
    return new PluginCapabilityError(diagnostic('E_WINDOW_RESTRICTED', { plugin }));
  }
  if (!options.listening()) {
    return new PluginCapabilityError(diagnostic('E_WINDOW_AGENTS_OFF', { plugin }));
  }
  return undefined;
}

/** A TOML literal string: no escapes inside, so a Windows path reads as it is written. */
const literal = (value: string): string => `'${value}'`;

/** Codex's `-c` overrides for the same server; values are TOML. */
export function codexOverrides(
  options: Pick<AgentLaunchOptions, 'relay' | 'pid' | 'home'>,
): readonly string[] {
  const env = `{ ${WINDOW_PID_VARIABLE} = ${literal(String(options.pid))}, TYTO_HOME = ${literal(options.home)} }`;
  return [
    '-c',
    `mcp_servers.tyto.command=${literal(options.relay.node)}`,
    '-c',
    `mcp_servers.tyto.args=[${literal(options.relay.script)}]`,
    '-c',
    `mcp_servers.tyto.env=${env}`,
  ];
}

/** Nothing on the command line may hold a quote of either kind, or a line break. */
const carriable = (value: string): boolean => !/['"\r\n]/u.test(value);

/**
 * The program to start and what to write first, or why nothing starts. Claude Code and Codex
 * are told about the relay; any other program starts with `TYTO_WINDOW` in its environment only,
 * which the terminal carries anyway (ADR 0181), and can register the relay itself.
 */
export function agentLaunch(options: AgentLaunchOptions): AgentLaunch {
  const file = findProgram(options, options.command);
  if (file === undefined) return { refused: notFound(options.command) };
  const name = programName(file).replace(/\.(?:cmd|bat|com)$/u, '');
  const title = name;
  const tail = [...options.args];
  if (name === 'claude') {
    if (!carriable(options.configFile)) return { refused: unsafeValue(options.configFile) };
    return {
      choice: { file, args: ['--mcp-config', options.configFile, ...tail], title },
      config: { file: options.configFile, text: claudeConfig(options) },
    };
  }
  if (name === 'codex') {
    for (const value of [options.relay.node, options.relay.script, options.home]) {
      if (!carriable(value)) return { refused: unsafeValue(value) };
    }
    return { choice: { file, args: [...codexOverrides(options), ...tail], title } };
  }
  return { choice: { file, args: tail, title } };
}

/**
 * Where the relay is: beside the plugin bootstrap, from the same Node (ADR 0050). Unpacked from
 * the asar in a package, because the bundled Node is not Electron and cannot read inside one.
 */
export function agentRelayPaths(options: {
  readonly packaged: boolean;
  /** `out/main`, the folder main's bundle is in. */
  readonly mainDirectory: string;
  readonly resourcesPath: string;
  readonly platform: string;
  readonly join: (...parts: string[]) => string;
}): AgentRelay {
  const { join } = options;
  const binary = options.platform === 'win32' ? 'node.exe' : 'node';
  if (!options.packaged) {
    return {
      node: join(options.mainDirectory, '..', 'node', binary),
      script: join(options.mainDirectory, '..', 'relay', 'agent-relay.js'),
    };
  }
  return {
    node: join(options.resourcesPath, 'node', binary),
    script: join(options.resourcesPath, 'app.asar.unpacked', 'out', 'relay', 'agent-relay.js'),
  };
}

/** `TYTO_HOME/agents/window-<pid>.json`: the Claude Code configuration, one per window. */
export function agentConfigFile(home: string, pid: number, platform: NodeJS.Platform): string {
  const path = platform === 'win32' ? win32 : posix;
  return path.join(home, 'agents', `window-${String(pid)}.json`);
}
