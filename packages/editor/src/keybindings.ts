import {
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticParams,
  type SourceRange,
  diagnostic,
} from '@tyto/core';

import type { CommandBinding, EditorKeymap } from './keymap.js';

/**
 * One keybinding table for the whole window (TYTO-207, ADR 0074).
 *
 * Pure on purpose: no CodeMirror, no DOM, no Node. What this module decides — which key runs
 * which command, in which context, after the built-in set, every plugin and the person's own
 * file have had their say — is a question about data, and the answer has to be the same in
 * the editor that runs the keys, the window that runs the global ones and the command bar
 * that shows them. CodeMirror only ever sees the result.
 */

/**
 * The contexts a binding can be limited to, and there are no others.
 *
 * A closed list rather than VS Code's expression language: six names a person can read in
 * one line, each of which the window can answer without evaluating anything.
 *
 * - `editor` — the editor has focus, in either input mode.
 * - `vim.normal` / `vim.insert` — vim mode is on and the engine is (not) in insert mode.
 * - `mode.desktop` — the editor has focus and vim mode is off.
 * - `commandBar` — the command bar is open.
 * - `panel` — focus is in a panel other than the editor, and the bar is closed.
 *
 * A binding with no `when` is global: it runs wherever focus is.
 */
export const KEYBINDING_CONTEXTS = [
  'editor',
  'vim.normal',
  'vim.insert',
  'mode.desktop',
  'commandBar',
  'panel',
] as const;

export type KeybindingContext = (typeof KEYBINDING_CONTEXTS)[number];

/** The contexts CodeMirror answers; the other two, and global keys, are the window's. */
export const EDITOR_CONTEXTS: ReadonlySet<KeybindingContext> = new Set(
  KEYBINDING_CONTEXTS.slice(0, 4),
);

const isContext = (when: string): when is KeybindingContext =>
  (KEYBINDING_CONTEXTS as readonly string[]).includes(when);

/**
 * The command bar's own command and key, which nothing can take away.
 *
 * The bar is the one door to every command, including whatever would put a broken binding
 * right; a table that could unbind it could lock a person out of the fix (ADR 0074).
 */
export const COMMAND_BAR_TOGGLE = 'commandBar.toggle';
export const COMMAND_BAR_KEY = 'Mod-k';

/** An entry as a plugin or the person writes it: `{ key: 'mod+shift+s', command, when? }`. */
export interface KeybindingEntry {
  readonly key: string;
  /** A command id, or `-<id>` to remove that command's binding on this key. */
  readonly command: string;
  readonly when?: string;
  /** Where the entry was written, so a diagnostic lands on it. */
  readonly range?: SourceRange;
}

export type KeybindingSource = 'built-in' | 'plugin' | 'user';

/** A binding in the resolved table, in CodeMirror's notation. */
export interface Keybinding {
  /** `Mod-Shift-s`: modifiers in the fixed order Mod, Ctrl, Meta, Alt, Shift. */
  readonly key: string;
  /** Overrides `key` on macOS; only the built-in set uses it. */
  readonly mac?: string;
  readonly command: string;
  readonly when?: KeybindingContext;
  readonly source: KeybindingSource;
}

/** The table, highest precedence first, which is the order CodeMirror should try them in. */
export interface KeybindingTable {
  readonly bindings: readonly Keybinding[];
}

/* ------------------------------------------------------------------------------- keys -- */

const MODIFIERS: Readonly<Record<string, string>> = {
  mod: 'Mod',
  ctrl: 'Ctrl',
  cmd: 'Meta',
  meta: 'Meta',
  alt: 'Alt',
  shift: 'Shift',
};
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];

const NAMED_KEYS: Readonly<Record<string, string>> = Object.fromEntries([
  ...['Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End']
    .concat(['PageUp', 'PageDown'])
    .map((name) => [name.toLowerCase(), name]),
  ...['Up', 'Down', 'Left', 'Right'].map((name) => [name.toLowerCase(), `Arrow${name}`]),
]);

const keyName = (written: string): string | undefined => {
  if (/^[a-z0-9`\-=[\];',./\\]$/u.test(written)) return written;
  if (/^f([1-9]|1[0-9]|2[0-4])$/u.test(written)) return written.toUpperCase();
  return NAMED_KEYS[written];
};

export type ParsedKey =
  | { readonly ok: true; readonly key: string; readonly modified: boolean }
  | { readonly ok: false; readonly problem: string };

/**
 * `mod+shift+s` → `Mod-Shift-s`.
 *
 * Lowercase and `+`-separated, the way VS Code and Zed write keys, and turned into
 * CodeMirror's notation in one fixed modifier order so that two spellings of the same key
 * compare equal. `mod` stays `Mod`, which CodeMirror reads as Cmd on macOS and Ctrl elsewhere.
 * A sequence (`ctrl+k ctrl+c`) is refused: CodeMirror can run one, the window dispatcher
 * cannot, and a key that works in one place and not the other is worse than none.
 */
export function parseKey(text: string): ParsedKey {
  if (/\s/u.test(text.trim()) || text.trim() !== text) {
    return { ok: false, problem: 'a sequence of keys, or a space around one, is not supported' };
  }
  if (text !== text.toLowerCase()) return { ok: false, problem: 'keys are written in lowercase' };

  // `ctrl+-` and `ctrl++`: the last part is the key even when it is the separator itself.
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
  const written = parts.pop() ?? '';
  const name = written === '+' ? undefined : keyName(written);
  if (name === undefined) return { ok: false, problem: `'${written}' is not a key name` };

  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = MODIFIERS[part];
    if (modifier === undefined) return { ok: false, problem: `'${part}' is not a modifier` };
    if (modifiers.has(modifier)) return { ok: false, problem: `'${part}' is written twice` };
    modifiers.add(modifier);
  }

  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return { ok: true, key: [...ordered, name].join('-'), modified: ordered.length > 0 };
}

/**
 * The key a binding is on this platform, with `Mod` spelled out — what two bindings are
 * compared by. `Mod-k` and `Ctrl-k` are the same key on Windows and different ones on macOS.
 */
export function concreteKey(binding: Pick<Keybinding, 'key' | 'mac'>, platform: string): string {
  const mac = platform === 'darwin';
  const parts = (mac ? (binding.mac ?? binding.key) : binding.key).split(/-(?!$)/u);
  const name = parts.pop() ?? '';
  const modifiers = new Set(
    parts.map((modifier) => (modifier === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : modifier)),
  );
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), name].join('-');
}

/** What the window dispatcher matches a keydown against, in `concreteKey`'s notation. */
export interface KeyStroke {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export function keyOfStroke(stroke: KeyStroke): string {
  const name =
    stroke.key === ' ' ? 'Space' : stroke.key.length === 1 ? stroke.key.toLowerCase() : stroke.key;
  return [
    ...(stroke.ctrlKey ? ['Ctrl'] : []),
    ...(stroke.metaKey ? ['Meta'] : []),
    ...(stroke.altKey ? ['Alt'] : []),
    ...(stroke.shiftKey ? ['Shift'] : []),
    name,
  ].join('-');
}

/* -------------------------------------------------------------------------- resolving -- */

/** One plugin's entries, applied in the order the plugins were activated. */
export interface KeybindingLayer {
  readonly entries: readonly KeybindingEntry[];
}

export interface KeybindingInput {
  readonly builtIn: readonly Keybinding[];
  readonly plugins: readonly KeybindingLayer[];
  /** The person's own entries. Empty until the keybindings file exists (TYTO-207, PR B). */
  readonly user: readonly KeybindingEntry[];
  /** Every command id a binding may name; the bar's toggle is always one. */
  readonly commands: ReadonlySet<string>;
  readonly platform: string;
}

export interface ResolvedKeybindings {
  readonly table: KeybindingTable;
  readonly diagnostics: readonly Diagnostic[];
}

/** Whether a binding in context `higher` takes the key from one in `lower`. */
const covers = (higher: KeybindingContext | undefined, lower: KeybindingContext | undefined) =>
  higher === undefined ||
  higher === lower ||
  (higher === 'editor' && lower !== undefined && EDITOR_CONTEXTS.has(lower));

const whereOf = (when: KeybindingContext | undefined): string =>
  when === undefined ? 'everywhere' : `in '${when}'`;

/**
 * Built-in, then each plugin, then the person: a later layer wins.
 *
 * Each entry is checked alone and a bad one costs only itself, as a setting does
 * (ADR 0073): the diagnostic carries the entry's range and the rest of the table stands.
 * A binding that takes a key from a lower layer removes the lower one, rather than leaving
 * both for CodeMirror to order, so the command bar never shows a key that runs something
 * else.
 */
export function resolveKeybindings(input: KeybindingInput): ResolvedKeybindings {
  const { platform } = input;
  const diagnostics: Diagnostic[] = [];
  // Lowest precedence first while building; reversed at the end.
  let current: Keybinding[] = [...input.builtIn].reverse();
  const lockKey = concreteKey({ key: COMMAND_BAR_KEY }, platform);
  const known = (command: string) => command === COMMAND_BAR_TOGGLE || input.commands.has(command);

  const apply = (entries: readonly KeybindingEntry[], source: KeybindingSource): void => {
    const seen = new Set<string>();

    for (const entry of entries) {
      const refuse = <Code extends DiagnosticCode>(code: Code, params: DiagnosticParams<Code>) => {
        diagnostics.push(
          diagnostic(code, params, entry.range === undefined ? {} : { range: entry.range }),
        );
      };
      const { key: written, command, when } = entry;
      if (when !== undefined && !isContext(when)) {
        const contexts = KEYBINDING_CONTEXTS.join(', ');
        refuse('W_KEYBINDING_UNKNOWN_CONTEXT', { key: written, when, contexts });
        continue;
      }
      const parsed = parseKey(written);
      if (!parsed.ok) {
        refuse('W_KEYBINDING_INVALID_KEY', { key: written, problem: parsed.problem });
        continue;
      }
      const key = concreteKey({ key: parsed.key }, platform);

      if (command.startsWith('-')) {
        const target = command.slice(1);
        if (target === COMMAND_BAR_TOGGLE) {
          refuse('W_KEYBINDING_LOCKED', { key: written, problem: 'be unbound' });
          continue;
        }
        current = current.filter(
          (binding) =>
            binding.command !== target ||
            concreteKey(binding, platform) !== key ||
            (when !== undefined && binding.when !== when),
        );
        continue;
      }

      if (!known(command)) {
        refuse('W_KEYBINDING_UNKNOWN_COMMAND', { key: written, command });
        continue;
      }
      // A key with no modifier types a character everywhere except in vim's normal mode, so
      // it is accepted only where the person said vim. Function keys type nothing.
      if (!parsed.modified && !/^F\d+$/u.test(parsed.key) && !when?.startsWith('vim.')) {
        const problem = "a key with no modifier types a character; give it when 'vim.normal'";
        refuse('W_KEYBINDING_INVALID_KEY', { key: written, problem });
        continue;
      }
      if (key === lockKey && command !== COMMAND_BAR_TOGGLE) {
        refuse('W_KEYBINDING_LOCKED', { key: written, problem: `run '${command}'` });
        continue;
      }
      const slot = `${key} ${when ?? ''}`;
      if (seen.has(slot)) {
        refuse('W_KEYBINDING_DUPLICATE', { key: written, where: whereOf(when) });
        continue;
      }
      seen.add(slot);

      current = current.filter(
        (binding) => concreteKey(binding, platform) !== key || !covers(when, binding.when),
      );
      current.push({ key: parsed.key, command, ...(when === undefined ? {} : { when }), source });
    }
  };

  for (const layer of input.plugins) apply(layer.entries, 'plugin');
  apply(input.user, 'user');

  return { table: { bindings: current.reverse() }, diagnostics };
}

/* ---------------------------------------------------------------------------- reading -- */

/** A built-in set's bindings as table entries, all in one context. */
export function keybindingsOf(
  set: EditorKeymap,
  when: KeybindingContext | undefined,
): readonly Keybinding[] {
  return set.bindings.map((binding) => ({
    key: binding.key,
    ...(binding.mac === undefined ? {} : { mac: binding.mac }),
    command: binding.command,
    ...(when === undefined ? {} : { when }),
    source: 'built-in' as const,
  }));
}

/**
 * The bindings CodeMirror runs in one input mode, as a set it can be handed.
 *
 * `vim.normal` and `vim.insert` bindings carry their context with them, because the editor
 * has to ask the vim engine which of the two it is in at the moment of the keystroke.
 */
export function keymapSetFor(table: KeybindingTable, vim: boolean): EditorKeymap {
  const active = (when: KeybindingContext | undefined): boolean =>
    when === 'editor' ||
    (vim ? when === 'vim.normal' || when === 'vim.insert' : when === 'mode.desktop');

  const bindings: CommandBinding[] = table.bindings
    .filter((binding) => active(binding.when))
    .map((binding) => ({
      key: binding.key,
      ...(binding.mac === undefined ? {} : { mac: binding.mac }),
      command: binding.command,
      ...(binding.when === 'vim.normal' || binding.when === 'vim.insert'
        ? { when: binding.when }
        : {}),
    }));
  return { id: vim ? 'vim' : 'desktop', bindings };
}

/** The bindings the window dispatcher runs: the global ones, the bar's and the panels'. */
export function windowBindingsOf(table: KeybindingTable): readonly Keybinding[] {
  return table.bindings.filter(
    (binding) => binding.when === undefined || !EDITOR_CONTEXTS.has(binding.when),
  );
}

/**
 * The keystroke a command answers to, written the way a person reads it.
 *
 * `Mod` is `⌘` on macOS and `Ctrl` everywhere else, which is what CodeMirror's notation
 * means by it; a set may also override the whole binding for macOS, and that wins.
 */
export function bindingsOf(
  keymapSet: EditorKeymap,
  platform: string,
): Readonly<Record<string, string>> {
  const mac = platform === 'darwin';
  const bindings: Record<string, string> = {};

  for (const binding of keymapSet.bindings) {
    const key = (mac ? (binding.mac ?? binding.key) : binding.key)
      .replace(/\bMod\b/gu, mac ? '⌘' : 'Ctrl')
      .replace(/\bMeta\b/gu, mac ? '⌘' : 'Meta')
      .replace(/\bShift\b/gu, mac ? '⇧' : 'Shift')
      .replace(/\bAlt\b/gu, mac ? '⌥' : 'Alt')
      .replaceAll('-', mac ? '' : '+');
    // The first binding wins. A set may bind two keys to one command — redo has three —
    // and a person looking for the shortcut wants one of them, not a list.
    bindings[binding.command] ??= key;
  }

  return bindings;
}

/**
 * What the command bar shows beside each command in one input mode: the editor's bindings
 * for that mode first, then the window's, read off the same table that runs them.
 */
export function shownBindingsOf(
  table: KeybindingTable,
  vim: boolean,
  platform: string,
): Readonly<Record<string, string>> {
  const window = windowBindingsOf(table).map(({ key, mac, command }) => ({
    key,
    command,
    ...(mac === undefined ? {} : { mac }),
  }));
  return bindingsOf(
    { id: 'shown', bindings: [...keymapSetFor(table, vim).bindings, ...window] },
    platform,
  );
}
