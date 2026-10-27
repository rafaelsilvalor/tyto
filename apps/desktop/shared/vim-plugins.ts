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
  /**
   * `false` for a plugin that starts off until the setting names it `true` (ADR 0143, TYTO-419
   * A2 amendment). Only a built-in can say so; an installed plugin is on unless named false.
   */
  readonly defaultOn?: false;
}

/**
 * A `vimPlugins` id that switches an editor effect instead of a contribution (ADR 0143, TYTO-419
 * A2 amendment): there is no key to map, so the window calls the editor's switch itself.
 */
export interface BuiltInVimEffect {
  readonly id: 'highlightedYank' | 'systemClipboard';
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

/**
 * ReplaceWithRegister's `gr`: an operator with no context, as `gc`, so `grr` (a repeated
 * multi-key operator is linewise), a count, visual `gr` and `.` come from the engine.
 */
const replaceWithRegister: BuiltInVimPlugin = {
  contribution: {
    id: 'replaceWithRegister',
    title: 'ReplaceWithRegister',
    mappings: [{ keys: 'gr', operation: 'replaceWithRegister' }],
  },
  description:
    'gr{motion}, grr and visual gr replace text with a register ("agr with register a) and leave the register as it was, so p still pastes what was yanked.',
};

/**
 * vim-exchange: `x` and `c` after an operator, by the pattern of surround's `s`, because `c` is
 * a whole operator and `cx` is never two keys; visual `X` maps the operator itself.
 */
const exchange: BuiltInVimPlugin = {
  contribution: {
    id: 'exchange',
    title: 'Exchange',
    mappings: [
      { keys: 'x', context: 'operatorPending', operation: 'exchange.target' },
      { keys: 'c', context: 'operatorPending', operation: 'exchange.clear' },
      { keys: 'X', context: 'visual', operation: 'exchange' },
    ],
  },
  description:
    'cx{motion} marks text and a second cx{motion} swaps the two; cxx marks a line, visual X marks the selection and cxc forgets the mark. Off, visual X deletes lines again.',
};

/** The part of vim-unimpaired that edits text: blank lines and moved lines, in normal mode. */
const unimpaired: BuiltInVimPlugin = {
  contribution: {
    id: 'unimpaired',
    title: 'Unimpaired',
    mappings: [
      { keys: '[<Space>', context: 'normal', operation: 'unimpaired.blank', args: { up: true } },
      { keys: ']<Space>', context: 'normal', operation: 'unimpaired.blank' },
      { keys: '[e', context: 'normal', operation: 'unimpaired.move', args: { up: true } },
      { keys: ']e', context: 'normal', operation: 'unimpaired.move' },
    ],
  },
  description:
    '[<Space> and ]<Space> add a blank line above or below; [e and ]e move the line up or down. A count repeats either.',
};

/** A text object names both contexts it works in (ADR 0142 decision 3). */
const textObject = (keys: string, operation: string, inner: boolean) =>
  (['visual', 'operatorPending'] as const).map((context) => ({
    keys,
    context,
    operation,
    ...(inner ? { args: { inner: true } } : {}),
  }));

/** vim-indent-object's `ii` and `ai` (ADR 0142). */
const indentObject: BuiltInVimPlugin = {
  contribution: {
    id: 'indentObject',
    title: 'Indent object',
    mappings: [
      ...textObject('ii', 'indentObject', true),
      ...textObject('ai', 'indentObject', false),
    ],
  },
  description:
    "ii is the block of lines at the cursor's indent or deeper and ai adds the line that opens it, after an operator or in visual mode: dii, yai, vii.",
};

/** textobj-entire's `ie` and `ae` (ADR 0142). */
const entireBuffer: BuiltInVimPlugin = {
  contribution: {
    id: 'entireBuffer',
    title: 'Entire buffer',
    mappings: [
      ...textObject('ie', 'entireBuffer', true),
      ...textObject('ae', 'entireBuffer', false),
    ],
  },
  description:
    'ae is every line of the file and ie leaves blank lines at either end out, after an operator or in visual mode: yae, dae, vie.',
};

/**
 * vim-sneak, in normal mode only. **Off unless named true**: on, it shadows vim's own `s` and
 * `S`, which a person who never asked for sneak would lose (ADR 0143, TYTO-419 A2 amendment).
 */
const sneak: BuiltInVimPlugin = {
  contribution: {
    id: 'sneak',
    title: 'Sneak',
    mappings: [
      { keys: 's', context: 'normal', operation: 'sneak' },
      { keys: 'S', context: 'normal', operation: 'sneak', args: { backward: true } },
      { keys: ';', context: 'normal', operation: 'sneak.repeat' },
      { keys: ',', context: 'normal', operation: 'sneak.repeat', args: { reverse: true } },
    ],
  },
  defaultOn: false,
  description:
    "Off unless set to true. s{char}{char} jumps to the next place those two characters appear and S to the previous one; ; and , repeat the last sneak or f/t. On, vim's own s and S are gone in normal mode.",
};

/** In the order the settings tab and the example list them. */
export const BUILT_IN_VIM_PLUGINS: readonly BuiltInVimPlugin[] = [
  surround,
  commentary,
  replaceWithRegister,
  exchange,
  unimpaired,
  indentObject,
  entireBuffer,
  sneak,
];

/** The effects, listed after the plugins. Both start on. */
export const BUILT_IN_VIM_EFFECTS: readonly BuiltInVimEffect[] = [
  {
    id: 'highlightedYank',
    description: 'A yank marks the yanked text for a moment, as vim-highlightedyank does.',
  },
  {
    id: 'systemClipboard',
    description:
      'y also copies to the system clipboard (a named register such as "ay does not), and text copied in another program is what p pastes once the editor has focus again.',
  },
];

/** Every id the setting documents: the built-ins'. An installed plugin's is its own. */
const DOCUMENTED_IDS = [
  ...BUILT_IN_VIM_PLUGINS.map(({ contribution, description, defaultOn }) => ({
    value: contribution.id,
    description,
    on: defaultOn ?? true,
  })),
  ...BUILT_IN_VIM_EFFECTS.map(({ id, description }) => ({ value: id, description, on: true })),
];

/** The built-ins that start off; any other id is on unless the setting names it false. */
const OFF_BY_DEFAULT: ReadonlySet<string> = new Set(
  BUILT_IN_VIM_PLUGINS.filter(({ defaultOn }) => defaultOn === false).map(
    ({ contribution }) => contribution.id,
  ),
);

export type VimPlugins = Readonly<Record<string, boolean>>;

/**
 * Whether a vim plugin is on. **Every vim plugin is on unless the setting says false**,
 * built-in and installed alike (Rafael, 2026-10-26): the file names the ones a person turns off.
 * The exception is a built-in that says `defaultOn: false`, sneak, which is off unless the file
 * names it true (ADR 0143, TYTO-419 A2 amendment).
 */
export const vimPluginIsOn = (switches: VimPlugins, id: string): boolean =>
  switches[id] ?? !OFF_BY_DEFAULT.has(id);

/**
 * The key is open: an installed plugin's `editor.vim` contribution is switched by its own id,
 * which the settings tab cannot know in advance. Each member is checked on its own
 * (`members`), so a value that is not a boolean is a warning at that value and only that
 * plugin falls back to its default.
 */
const pluginId = z.string().min(1, 'a vim plugin is named by its id');
const switchValue = z.boolean({ error: 'a vim plugin is switched with true or false' });

export const vimPluginsContribution = {
  id: 'vimPlugins',
  schema: z.record(pluginId, switchValue).readonly(),
  default: {},
  description:
    'Switch each vim plugin on or off by its id, with true or false; every vim plugin, built-in or installed, is on unless named false here, except sneak, which is off unless named true. ' +
    DOCUMENTED_IDS.map((entry) => `${entry.value}: ${entry.description}`).join(' '),
  members: {
    key: pluginId,
    schema: switchValue,
    options: DOCUMENTED_IDS.map(({ value, description }) => ({ value, description })),
  },
} satisfies ConfigurationContribution<VimPlugins>;

/** The key as a newly created `settings.json` shows it, commented out, with every id. */
export function vimPluginsExample(): string {
  return [
    '// Switch each vim plugin on or off by its id; each one is shown with its default.',
    '// "vimPlugins": {',
    ...DOCUMENTED_IDS.map(
      (entry, index) =>
        `//   "${entry.value}": ${String(entry.on)}${index === DOCUMENTED_IDS.length - 1 ? '' : ','}`,
    ),
    '// },',
  ]
    .map((line) => `  ${line}`)
    .join('\n');
}
