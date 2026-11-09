import { diagnostic } from '@tyto/core';
import { z } from 'zod';

import { type HostCapabilities, PluginCapabilityError } from './capabilities.js';
import { PROCESS_PERMISSION, programNameProblem } from './process.js';

/**
 * The window's MCP server, handed to a plugin for the agent it starts (ADR 0183).
 *
 * An agent a plugin starts through `process:<name>` (ADR 0182) reaches the open window the way
 * an agent in a Tyto terminal does (ADR 0181): through the relay Tyto ships, run on the bundled
 * Node, with `TYTO_WINDOW` naming the window and `TYTO_HOME` naming where the window's record
 * is. The plugin cannot know those paths, so the host says them, in the shape the Agent Client
 * Protocol's `session/new` takes in `mcpServers`: `{ name, command, args, env }`, with `env` a
 * list of `{ name, value }`. The plugin sends it to the agent on stdin, inside JSON, so no
 * command line ever carries it.
 *
 * **No permission of its own.** The answer carries no secret: the window's token stays in its
 * record, which only a program the person allowed can read (ADR 0180 decision 3). Without a
 * program to hand it to, the answer is of no use; with one, that program, which is not
 * confined, could find the relay from `TYTO_WINDOW` itself (ADR 0182 decision 9). So the service
 * answers a plugin that declares at least one `process:<name>`, and the install prompt says what
 * that program can then do in the window.
 */

/** The name the server has in the agent's list, as Open an Agent Here names it (ADR 0181). */
export const WINDOW_AGENT_SERVER_NAME = 'tyto';

/** One variable of the server's environment, as ACP writes it. */
export interface AgentServerVariable {
  readonly name: string;
  readonly value: string;
}

/** A stdio MCP server, in the shape of an entry of ACP's `mcpServers`. */
export interface AgentServer {
  readonly name: string;
  /** An absolute path: the bundled Node. */
  readonly command: string;
  /** The relay's script, and nothing a shell would read: no shell runs it. */
  readonly args: readonly string[];
  readonly env: readonly AgentServerVariable[];
}

/**
 * The only variables the server's environment may carry: the window's process id and the folder
 * its record is in, the two the relay reads (ADR 0181 decision 3). An allowlist rather than
 * ADR 0182's secret-shaped names, because this answer has exactly one job: checked on the host's
 * side, an adapter that one day adds a variable cannot hand a plugin an API key through it.
 */
export const AGENT_SERVER_VARIABLES: readonly string[] = ['TYTO_WINDOW', 'TYTO_HOME'];

/** What the port answers and what crosses the isolation boundary, checked field by field. */
export const agentServerSchema = z.strictObject({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.array(z.strictObject({ name: z.string().min(1), value: z.string() })),
});

/** `host.window`: what a plugin's program needs to reach the open window. */
export interface HostWindow {
  /**
   * The window's MCP server, for the agent a plugin starts. A plugin with no `process:<name>`
   * permission is `E_PERMISSION`; a host with no window (the CLI) is `E_WINDOW_UNAVAILABLE`;
   * `agentsListen` off is `E_WINDOW_AGENTS_OFF`; a restricted folder is `E_WINDOW_RESTRICTED`.
   * Asked again each time: the setting and the folder's trust can change between two calls.
   */
  agentServer(): Promise<AgentServer>;
}

/** The `host.window` both sides of the isolation boundary hand a plugin. */
export function hostWindow(agentServer: () => Promise<AgentServer>): HostWindow {
  return { agentServer };
}

/** Whether the manifest names a program, which is what makes the answer of any use. */
export function namesAProgram(permissions: readonly string[]): boolean {
  return permissions.some(
    (permission) =>
      permission.startsWith(PROCESS_PERMISSION) &&
      programNameProblem(permission.slice(PROCESS_PERMISSION.length)) === undefined,
  );
}

/**
 * The check in front of {@link HostCapabilities.windowAgentServer}, on the host's side of the
 * boundary, against the manifest the host validated. The adapter's own refusals (the setting,
 * the folder's trust) reach the plugin as they are.
 */
export function checkedWindowAgentServer(
  plugin: string,
  permissions: readonly string[],
  capabilities: HostCapabilities | undefined,
): () => Promise<AgentServer> {
  return async () => {
    if (!namesAProgram(permissions)) {
      throw new PluginCapabilityError(
        diagnostic('E_PERMISSION', {
          plugin,
          capability: `host.window.agentServer() (a ${PROCESS_PERMISSION}<name> permission)`,
        }),
      );
    }
    const host = capabilities?.hostName ?? 'this host';
    if (capabilities?.windowAgentServer === undefined) {
      throw new PluginCapabilityError(diagnostic('E_WINDOW_UNAVAILABLE', { plugin, host }));
    }
    // Read as `unknown`: the adapter is typed, but this is the check that does not trust it.
    const answer: unknown = await capabilities.windowAgentServer(plugin);
    const parsed = agentServerSchema.safeParse(answer);
    if (!parsed.success) {
      throw new TypeError(`${host} answered the window's agent server with something else.`);
    }
    const extra = parsed.data.env.find(
      (variable) => !AGENT_SERVER_VARIABLES.includes(variable.name),
    );
    if (extra !== undefined) {
      throw new TypeError(
        `${host} put ${extra.name} in the window's agent server, which carries only ${AGENT_SERVER_VARIABLES.join(' and ')} (ADR 0183).`,
      );
    }
    return parsed.data;
  };
}
