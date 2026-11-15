import { ALIAS_NAME, aliasBodyProblem } from '@tyto/core';

import type { IpcResponse } from '../../shared/ipc.js';
import { type CommandAliases, aliasesInForce } from '../../shared/command-aliases.js';

/**
 * The command panel's aliases as main keeps them (TYTO-536, ADR 0200 note of 2026-11-15): read
 * from the `commandAliases` setting and the open folder's resolved project, and written by
 * `alias` back to the setting. Main checks every write itself: the window is not the boundary.
 */

/** What the window's `alias` reads: the person's, with the open folder's over them by name. */
export function aliasesAnswer(
  user: CommandAliases,
  workspace: readonly { readonly name: string; readonly body: string }[],
): IpcResponse<'commands:aliases'> {
  return { aliases: aliasesInForce(user, workspace).slice(0, 500) };
}

/** Why a name or body cannot be written, by the rules the readers apply. */
export function aliasWriteProblem(name: string, body: string | null): 'invalid' | undefined {
  if (!ALIAS_NAME.test(name)) return 'invalid';
  if (body !== null && aliasBodyProblem(body) !== undefined) return 'invalid';
  return undefined;
}
