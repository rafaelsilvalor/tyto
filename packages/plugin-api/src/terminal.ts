import { diagnostic } from '@tyto/core';

import { type HostCapabilities, PluginCapabilityError } from './capabilities.js';
import {
  PROCESS_PERMISSION,
  type PluginProgramScripts,
  allowsProcess,
  programScript,
} from './process.js';

/**
 * A terminal tab the host opens for a plugin, running one of its declared programs (ADR 0184).
 *
 * Some programs need a person at a keyboard: an agent CLI's login prints a link, opens the
 * browser on its provider's page and may ask for a code to paste. A program behind
 * `host.process` has pipes, not a terminal, and nobody sees it. So a plugin may ask the host to
 * open a Tyto terminal tab (ADR 0164) running a program it already declares as
 * `process:<name>`, with arguments, in the folder open in Tyto. **No new permission**: the
 * person approved that program by name, and a terminal shows them everything it does and lets
 * them close it.
 *
 * The plugin hears that the tab opened, and nothing after: not the output, not the end. What
 * the program did is read from the program's own state the next time the plugin asks it (a
 * login is read by the agent's next `initialize`), so no output a person typed into ever
 * reaches the plugin.
 */

/**
 * At most this many terminals one plugin opened are open at once (ADR 0184 decision 4). One: a
 * login is one tab, and a plugin that asks again while it is open would only stack tabs in
 * front of the person.
 */
export const PLUGIN_TERMINAL_LIMIT = 1;

/** A tab the adapter opened: `closed` settles when its program ends or the person closes it. */
export interface OpenedTerminal {
  readonly closed: Promise<void>;
}

/**
 * The port's signature, as {@link HostCapabilities.openTerminal} declares it. `script` is the
 * plugin-relative path the manifest's `programs` names for `program`, as for `startProcess`.
 */
export type OpenTerminal = (
  plugin: string,
  program: string,
  args: readonly string[],
  script?: string,
) => Promise<OpenedTerminal>;

/** `host.terminal`: a Tyto terminal tab running a program the manifest names (ADR 0184). */
export interface HostTerminal {
  /**
   * Opens a terminal tab running the program `name` with `args`, in the folder open in Tyto,
   * and resolves once it is open. Undeclared is `E_PERMISSION`; a host without terminals (the
   * CLI) is `E_TERMINAL_UNAVAILABLE`; a terminal of this plugin's still open is
   * `E_TERMINAL_LIMIT`; a restricted folder, a missing program and an argument the host cannot
   * pass are `E_PROCESS_RESTRICTED`, `E_PROCESS_NOT_FOUND` or `E_PROCESS_SCRIPT_MISSING`, and
   * `E_PROCESS_ARGUMENT`, as for `host.process.start`.
   */
  open(name: string, args?: readonly string[]): Promise<void>;
}

/** The `host.terminal` both sides of the isolation boundary hand a plugin. */
export function hostTerminal(
  open: (name: string, args: readonly string[]) => Promise<void>,
): HostTerminal {
  return { open: (name, args = []) => open(name, args) };
}

/**
 * The checks in front of {@link HostCapabilities.openTerminal}, for one plugin, on the host's
 * side of the boundary and against the manifest the host validated: the permission, the port,
 * and the number of tabs still open. The rest (the folder's trust, the program's file, the
 * arguments) is the adapter's, as for a program.
 */
export function checkedTerminal(
  plugin: string,
  permissions: readonly string[],
  capabilities: HostCapabilities | undefined,
  scripts: PluginProgramScripts = {},
): (name: string, args: readonly string[]) => Promise<void> {
  let open = 0;
  return async (name, args) => {
    if (typeof name !== 'string') throw new TypeError('a program name must be a string.');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new TypeError('the arguments of a program must be an array of strings.');
    }
    if (!allowsProcess(permissions, name)) {
      throw new PluginCapabilityError(
        diagnostic('E_PERMISSION', {
          plugin,
          capability: `host.terminal.open('${name}') (${PROCESS_PERMISSION}${name})`,
        }),
      );
    }
    const host = capabilities?.hostName ?? 'this host';
    if (capabilities?.openTerminal === undefined) {
      throw new PluginCapabilityError(
        diagnostic('E_TERMINAL_UNAVAILABLE', { plugin, program: name, host }),
      );
    }
    if (open >= PLUGIN_TERMINAL_LIMIT) {
      throw new PluginCapabilityError(
        diagnostic('E_TERMINAL_LIMIT', {
          plugin,
          program: name,
          limit: String(PLUGIN_TERMINAL_LIMIT),
        }),
      );
    }
    // Counted from the ask, so two quick asks cannot both pass a count of zero.
    open += 1;
    let opened: OpenedTerminal;
    try {
      const script = programScript(scripts, name);
      opened = await (script === undefined
        ? capabilities.openTerminal(plugin, name, [...args])
        : capabilities.openTerminal(plugin, name, [...args], script));
    } catch (cause) {
      open -= 1;
      throw cause;
    }
    // Read as `unknown`: the adapter is typed, but a tab it never reports closed would hold the
    // count forever, so a missing promise is the adapter's fault, said here.
    const closed: unknown = opened.closed;
    if (!(closed instanceof Promise)) {
      open -= 1;
      throw new TypeError(`${host} opened a terminal for '${name}' without saying when it closes.`);
    }
    void closed.then(
      () => (open -= 1),
      () => (open -= 1),
    );
  };
}
