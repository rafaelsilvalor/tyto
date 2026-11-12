import { posix, win32 } from 'node:path';

import type { CommandInvocation } from '@tyto/command-line';

/**
 * What the window refuses to run that a terminal runs (ADR 0159 decision 2). Each refusal is
 * one sentence that names the rule and says what to do instead; the command line then exits 1,
 * as a command line the parser refused does.
 *
 * The rules are the window's and not the CLI's: a terminal has no trust box and no queue panel
 * to collide with. The third refusal, a shell, is not here: it is `SHELL_REFUSED`, refused at
 * the step that would start one rather than by naming a command.
 */

export const TRUST_REFUSED =
  '--trust is not available in the window: a folder is trusted only through Workspace: Trust ' +
  '(ADR 0111). Trust the folder there, or run the command in a terminal.';

/**
 * `environment.shellRefusal` in the window (ADR 0159 decision 8): what a step that would start a
 * shell fails with. The CLI's one shell is `npm` on Windows, so it reads as that case; the step
 * refuses wherever it is reached from, `plugin install` today.
 */
export const SHELL_REFUSED =
  'The window starts no shell, and on Windows npm runs through one (ADR 0159): install the ' +
  'plugin from a folder or a git URL, or run the command in a terminal.';

export const WATCH_REFUSED =
  "That folder is the queue panel's, with auto-run on, and a queue folder has one consumer " +
  '(ADR 0159). Turn auto-run off in the queue panel, or watch another folder.';

/**
 * `tyto mcp` serves an agent on the standard streams of whoever started it (ADR 0179), and the
 * command panel has none of a person's to give: its output is a panel, not a pipe.
 */
export const MCP_REFUSED =
  'tyto mcp is not available in the window: it serves an agent over stdin and stdout (ADR 0179). ' +
  'Register tyto mcp with the agent, which starts it, or run it in a terminal.';

/**
 * `tyto recipe run --apply` applies plans and lends `call` a `send` with the window process's
 * environment (TYTO-684, ADR 0159 note of 2026-11-12). The panel only plans: Apply in the
 * notebook is the window's one way to apply, under its own trust and credential rules.
 */
export const APPLY_REFUSED =
  '--apply is not available in the window: the command panel only plans a recipe (ADR 0159). ' +
  "Apply its plan with the notebook's Apply button, or run the command in a terminal.";

export interface WindowRefusalOptions {
  readonly platform: NodeJS.Platform;
  /** The queue panel's folder and whether it runs what arrives on its own. */
  readonly queue: () => Promise<{ readonly folder: string | null; readonly autoRun: boolean }>;
}

/** The same folder, by the platform's rule: Windows paths compare without case. */
function sameFolder(platform: NodeJS.Platform, cwd: string, typed: string, other: string): boolean {
  const path = platform === 'win32' ? win32 : posix;
  const left = path.resolve(cwd, typed);
  const right = path.resolve(other);
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function windowRefusals(
  options: WindowRefusalOptions,
): (invocation: CommandInvocation, cwd: string) => Promise<string | undefined> {
  return async (invocation, cwd) => {
    if (invocation.options['trust'] === true) return TRUST_REFUSED;

    const [command] = invocation.path;
    const [first] = invocation.args;

    if (command === 'mcp') return MCP_REFUSED;

    // Read off the parsed options, so every spelling commander accepts is one value here. Only
    // the flag applies: without it the run is a save's and `apply auto` stays a plan
    // (`recipe-run.ts` in `@tyto/command-line`, ADR 0170 decision 6).
    if (
      command === 'recipe' &&
      invocation.path[1] === 'run' &&
      invocation.options['apply'] === true
    ) {
      return APPLY_REFUSED;
    }

    if (command === 'watch' && first !== undefined) {
      const queue = await options.queue();
      if (
        queue.autoRun &&
        queue.folder !== null &&
        sameFolder(options.platform, cwd, first, queue.folder)
      ) {
        return WATCH_REFUSED;
      }
    }

    return undefined;
  };
}
