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

/**
 * `tyto signin` and `tyto signout` keep a terminal's sign-ins in the system keychain (ADR 0194),
 * apart from the window's, and the window composes no keychain for the command panel. The
 * plugins screen is where the window signs in and out (ADR 0174).
 */
export const SIGNIN_REFUSED =
  'tyto signin and tyto signout are not available in the window: the window signs in from the ' +
  'plugins screen (ADR 0194). Sign in there, or run the command in a terminal.';

/**
 * The window's own way to do what a refused command asked (TYTO-726, ADR 0159 note of
 * 2026-11-15), offered in a box that names what it acts on. `mcp` has none: the panel has no
 * standard streams to give an agent.
 */
export type RefusalOffer =
  /** Workspace: Trust for the open folder, then the command without `--trust`. */
  | { readonly kind: 'trust'; readonly folder: string }
  /** The plugins screen's sign-in or sign-out for one declared sign-in. */
  | { readonly kind: 'signin'; readonly plugin: string; readonly id: string; readonly out: boolean }
  /** The recipe's notebook, whose Apply is the window's one way to apply. */
  | { readonly kind: 'apply'; readonly recipe: string }
  /** The queue panel's auto-run switch turned off, then the watch as typed. */
  | { readonly kind: 'watch'; readonly folder: string };

/**
 * Where a refused line came from when the person did not type it word for word: an alias of the
 * command panel (TYTO-536), named with where it is defined in the sentence and the box. A label
 * the window sends with `cli:run`; what is refused is still decided on the expanded words.
 */
export interface RefusalOrigin {
  readonly alias: string;
  readonly definedIn: 'user' | 'workspace';
}

export interface WindowRefusal {
  readonly message: string;
  readonly offer?: RefusalOffer;
  readonly origin?: RefusalOrigin;
}

export interface WindowRefusalOptions {
  readonly platform: NodeJS.Platform;
  /** The queue panel's folder and whether it runs what arrives on its own. */
  readonly queue: () => Promise<{ readonly folder: string | null; readonly autoRun: boolean }>;
  /** The folder the window has open, the one Workspace: Trust acts on; absent offers no trust. */
  readonly openFolder?: () => string | null;
  /** The sign-in ids the installed plugin declares, as the plugins screen lists them. */
  readonly signins?: (plugin: string) => Promise<readonly string[]>;
}

/** The same folder, by the platform's rule: Windows paths compare without case. */
function sameFolder(platform: NodeJS.Platform, cwd: string, typed: string, other: string): boolean {
  const path = platform === 'win32' ? win32 : posix;
  const left = path.resolve(cwd, typed);
  const right = path.resolve(other);
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * The sign-in a command line names, as `tyto signin` picks it: the id typed, or the plugin's
 * only one. Anything else is no offer, and the refusal stays a sentence.
 */
async function signinOffer(
  options: WindowRefusalOptions,
  invocation: CommandInvocation,
): Promise<RefusalOffer | undefined> {
  // `--client` types an OAuth client first, which the plugins screen asks for its own way.
  if (options.signins === undefined || invocation.options['client'] === true) return undefined;
  const [plugin, typed] = invocation.args;
  if (plugin === undefined) return undefined;
  const ids = await options.signins(plugin);
  const id = typed ?? (ids.length === 1 ? ids[0] : undefined);
  if (id === undefined || !ids.includes(id)) return undefined;
  return { kind: 'signin', plugin, id, out: invocation.path[0] === 'signout' };
}

export function windowRefusals(
  options: WindowRefusalOptions,
): (invocation: CommandInvocation, cwd: string) => Promise<WindowRefusal | undefined> {
  return async (invocation, cwd) => {
    if (invocation.options['trust'] === true) {
      const folder = options.openFolder?.() ?? null;
      return folder === null
        ? { message: TRUST_REFUSED }
        : { message: TRUST_REFUSED, offer: { kind: 'trust', folder } };
    }

    const [command] = invocation.path;
    const [first] = invocation.args;

    if (command === 'mcp') return { message: MCP_REFUSED };
    if (command === 'signin' || command === 'signout') {
      const offer = await signinOffer(options, invocation);
      return offer === undefined ? { message: SIGNIN_REFUSED } : { message: SIGNIN_REFUSED, offer };
    }

    // Read off the parsed options, so every spelling commander accepts is one value here. Only
    // the flag applies: without it the run is a save's and `apply auto` stays a plan
    // (`recipe-run.ts` in `@tyto/command-line`, ADR 0170 decision 6).
    if (
      command === 'recipe' &&
      invocation.path[1] === 'run' &&
      invocation.options['apply'] === true
    ) {
      const path = options.platform === 'win32' ? win32 : posix;
      return first === undefined
        ? { message: APPLY_REFUSED }
        : { message: APPLY_REFUSED, offer: { kind: 'apply', recipe: path.resolve(cwd, first) } };
    }

    if (command === 'watch' && first !== undefined) {
      const queue = await options.queue();
      if (
        queue.autoRun &&
        queue.folder !== null &&
        sameFolder(options.platform, cwd, first, queue.folder)
      ) {
        return { message: WATCH_REFUSED, offer: { kind: 'watch', folder: queue.folder } };
      }
    }

    return undefined;
  };
}
