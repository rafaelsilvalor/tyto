import type { ConfigurationContribution, EditorVimContribution } from '@tyto/plugin-api';
import { z } from 'zod';

/**
 * The vim plugins Tyto ships, and the `vimPlugins` setting that switches each one (TYTO-418,
 * ADR 0143).
 *
 * Each plugin is an `editor.vim` contribution of the `desktop` built-in plugin (ADR 0141): keys
 * mapped onto an operation `@tyto/editor` implements, data only. The operation names are the
 * editor's, written again here because `shared/` may not import a DOM package; one the editor
 * does not have is refused there as `E_VIM_CONTRIBUTION`, which a test of the window catches.
 *
 * In `shared/` because both halves read it: main registers the contributions and validates the
 * setting, and the window decides which ids are on. Linted pure.
 */

export interface BuiltInVimPlugin {
  readonly contribution: EditorVimContribution;
  /** What the settings tab says the plugin does, beside its id. */
  readonly description: string;
}

/**
 * vim-commentary's `gc`: an operator, so `gcc`, `gc{motion}` and visual `gc` come from the
 * engine. No context, as vim's own `gc` has none, so switching it off unmaps exactly this
 * entry and vim's `gc` is found again (ADR 0141 decision 2).
 */
const commentary: BuiltInVimPlugin = {
  contribution: {
    id: 'commentary',
    title: 'Commentary',
    mappings: [{ keys: 'gc', operation: 'comment' }],
  },
  description:
    "gc{motion}, gcc and visual gc toggle a comment with the language's own: // in a brief, <!-- --> in a Markdown file. Off, gc is vim's line comment only.",
};

/**
 * vim-surround: `s` after an operator, and visual `S` (ADR 0143 amendment). `c`, `d` and `y`
 * are whole operators in the engine, so `cs`, `ds` and `ys` are never three-key mappings: `s`
 * is a motion in `operatorPending` that reads the operator before it. Neither key is vim's
 * own after an operator; switched off, visual `S` is vim's again.
 */
const surround: BuiltInVimPlugin = {
  contribution: {
    id: 'surround',
    title: 'Surround',
    mappings: [
      { keys: 's', context: 'operatorPending', operation: 'surround.target' },
      { keys: 'S', context: 'visual', operation: 'surround.add' },
    ],
  },
  description:
    'ys{motion}{char}, yss{char}, cs{old}{new}, ds{char} and visual S{char} add, change or delete a pair around text: ( ) or b, [ ], { } or B, < >, and quotes. An opening bracket adds a space inside the pair.',
};

/** In the order the settings tab and the example list them. */
export const BUILT_IN_VIM_PLUGINS: readonly BuiltInVimPlugin[] = [surround, commentary];

/** Every id the setting documents: the built-ins'. An installed plugin's is its own. */
const DOCUMENTED_IDS = BUILT_IN_VIM_PLUGINS.map(({ contribution, description }) => ({
  value: contribution.id,
  description,
}));

export type VimPlugins = Readonly<Record<string, boolean>>;

/**
 * Whether a vim plugin is on. **Every vim plugin is on unless the setting says false**,
 * built-in and installed alike (Rafael, 2026-10-26): the file names the ones a person turns off.
 */
export const vimPluginIsOn = (switches: VimPlugins, id: string): boolean => switches[id] ?? true;

/**
 * The key is open: an installed plugin's `editor.vim` contribution is switched by its own id,
 * which the settings tab cannot know in advance. Each member is checked on its own
 * (`members`), so a value that is not a boolean is a warning at that value and only that
 * plugin falls back to on.
 */
const pluginId = z.string().min(1, 'a vim plugin is named by its id');
const switchValue = z.boolean({ error: 'a vim plugin is switched with true or false' });

export const vimPluginsContribution = {
  id: 'vimPlugins',
  schema: z.record(pluginId, switchValue).readonly(),
  default: {},
  description:
    'Switch each vim plugin on or off by its id, with true or false; every vim plugin, built-in or installed, is on unless named false here. ' +
    DOCUMENTED_IDS.map((entry) => `${entry.value}: ${entry.description}`).join(' '),
  members: {
    key: pluginId,
    schema: switchValue,
    options: DOCUMENTED_IDS,
  },
} satisfies ConfigurationContribution<VimPlugins>;

/** The key as a newly created `settings.json` shows it, commented out, with every id. */
export function vimPluginsExample(): string {
  return [
    '// Switch each vim plugin on or off by its id; every one is on unless named false here.',
    '// "vimPlugins": {',
    ...DOCUMENTED_IDS.map(
      (entry, index) =>
        `//   "${entry.value}": true${index === DOCUMENTED_IDS.length - 1 ? '' : ','}`,
    ),
    '// },',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
