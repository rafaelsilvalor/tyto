import type { Diagnostics, Result } from '@tyto/core';
import type { SystemClipboard, VimContribution } from '@tyto/editor';

import type { IpcResponse } from '../../shared/ipc.js';

import { type VimPlugins, vimPluginIsOn } from '../../shared/vim-plugins.js';

/**
 * The `vimPlugins` setting on the window's side (TYTO-418, ADR 0143): which of the vim
 * contributions main answered on `plugins:vim` are mapped into the editor's engine.
 *
 * Two things arrive at their own moments: the contributions, once, after the plugins have
 * started; and the setting, on every `theme:current` answer, so a save of `settings.json`
 * switches a plugin in place. Each arrival brings the engine to "these, and the ones on"; the
 * editor's `setVimContributions` is diffed against what it applied, so an answer that changed
 * nothing changes nothing in the engine either.
 */

/** `@tyto/editor`'s `setVimContributions`, passed in so the decision is tested without it. */
export type ApplyVimContributions = (
  contributions: readonly VimContribution[],
  enabled: Iterable<string>,
) => Result<readonly string[], Diagnostics>;

/** The ids switched on: each contribution's, unless the setting names it `false`. */
export const enabledVimPlugins = (
  contributions: readonly VimContribution[],
  switches: VimPlugins,
): string[] => contributions.map(({ id }) => id).filter((id) => vimPluginIsOn(switches, id));

/** One contribution as `plugins:vim` carries it, with the plugin that registered it. */
export type WireVimContribution = IpcResponse<'plugins:vim'>['contributions'][number];

/**
 * The editor's shape out of the wire's: an optional field the schema let through as absent is
 * left out, not written as `undefined`, and the plugin's name stays behind.
 */
export const vimContributionOf = ({
  id,
  title,
  mappings,
  ex,
}: WireVimContribution): VimContribution => ({
  id,
  ...(title === undefined ? {} : { title }),
  mappings: mappings.map(({ keys, context, operation, args }) => ({
    keys,
    operation,
    ...(context === undefined ? {} : { context }),
    ...(args === undefined ? {} : { args }),
  })),
  ...(ex === undefined
    ? {}
    : {
        ex: ex.map(({ name, shortName, command }) => ({
          name,
          command,
          ...(shortName === undefined ? {} : { shortName }),
        })),
      }),
});

export interface WindowVimPlugins {
  /** `plugins:vim` answered. */
  contributionsArrived(contributions: readonly VimContribution[]): void;
  /** A settings answer arrived, carrying `vimPlugins`. */
  settingArrived(switches: VimPlugins): void;
}

/**
 * `report` hears each `E_VIM_CONTRIBUTION` once per change: the setting arrives on every theme
 * answer, and the theme picker asks on every highlight, so the same refusal would otherwise
 * fill the log.
 */
export function createWindowVimPlugins(
  apply: ApplyVimContributions,
  report: (message: string) => void,
): WindowVimPlugins {
  let contributions: readonly VimContribution[] | undefined;
  let switches: VimPlugins = {};
  let reported = new Set<string>();

  const bring = (): void => {
    if (contributions === undefined) return;
    const result = apply(contributions, enabledVimPlugins(contributions, switches));
    const messages = result.ok
      ? result.diagnostics.map((item) => item.message)
      : result.error.map((item) => item.message);
    for (const message of messages) if (!reported.has(message)) report(message);
    reported = new Set(messages);
  };

  return {
    contributionsArrived(next) {
      contributions = next;
      bring();
    },
    settingArrived(next) {
      switches = next;
      bring();
    },
  };
}

/** `@tyto/editor`'s switches for the two effects, passed in so the decision is tested without it. */
export interface VimEffectSwitches {
  setVimYankFlash(on: boolean): void;
  setVimSystemClipboard(clipboard: SystemClipboard | undefined): void;
}

/**
 * The ids that switch an editor effect instead of a contribution (ADR 0143, TYTO-419 A2
 * amendment): `highlightedYank` the yank flash, `systemClipboard` the sharing of vim's yank with
 * `clipboard`. Called on every settings answer; both switches take the same value again with no
 * effect, and the same port keeps the last text it saw.
 */
export function applyVimEffects(
  switches: VimPlugins,
  editor: VimEffectSwitches,
  clipboard: SystemClipboard,
): void {
  editor.setVimYankFlash(vimPluginIsOn(switches, 'highlightedYank'));
  editor.setVimSystemClipboard(vimPluginIsOn(switches, 'systemClipboard') ? clipboard : undefined);
}
