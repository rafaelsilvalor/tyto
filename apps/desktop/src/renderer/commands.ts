import {
  type CommandRegistry,
  type EditorKeymap,
  EDITOR_REDO,
  EDITOR_UNDO,
  createCommandRegistry,
  defaultKeymapSet,
  vimKeymapSet,
} from '@tyto/editor';

import { type CatalogueKey } from '../../shared/i18n/index.js';

/**
 * What the window can be told to do, as ids (E9.12).
 *
 * `@tyto/editor` has shipped a command registry since E8.3, and its own comment says the
 * order of `list()` is the order a palette should show — and until this card nothing in
 * `apps/desktop/src` named `createCommandRegistry`. The registry was built and never wired.
 *
 * **The point of the ids is that a key and a palette entry name the same string.** A
 * binding, a vim ex-command and, later, a plugin all dispatch through `registry.run(id)`,
 * so `Mod-z` and "Desfazer" cannot drift into being two different undos.
 */

export const PREVIEW_ZOOM_IN = 'preview.zoomIn';
export const PREVIEW_ZOOM_OUT = 'preview.zoomOut';
export const PREVIEW_ZOOM_FIT = 'preview.zoomFit';
export const PREVIEW_NEXT_FORMAT = 'preview.nextFormat';
export const PREVIEW_PREVIOUS_FORMAT = 'preview.previousFormat';
export const PREVIEW_NEXT_SLIDE = 'preview.nextSlide';
export const PREVIEW_PREVIOUS_SLIDE = 'preview.previousSlide';
export const SHELL_TOGGLE_LOCALE = 'shell.toggleLocale';
export const EDITOR_TOGGLE_VIM = 'editor.toggleVim';

/**
 * The catalogue key each command is shown under.
 *
 * Not the `label` on the command itself, which is where a reader would look first. That
 * field is a plain string and `@tyto/editor` is a package with no locale — its two built-in
 * commands, `editor.undo` and `editor.redo`, carry English labels written where no
 * catalogue exists. Translating at the point of display keeps the registry the same object
 * in both languages, and a registry that had to be rebuilt to change language would be the
 * wrong shape for something plugins will register into.
 *
 * A command with no entry here falls back to its own `label`, and then to its id. That is
 * deliberate rather than defensive: a plugin's command will land in exactly that case, and
 * showing its id is better than hiding it.
 */
export const COMMAND_LABELS: Readonly<Record<string, CatalogueKey>> = {
  [EDITOR_UNDO]: 'command.undo',
  [EDITOR_REDO]: 'command.redo',
  [PREVIEW_ZOOM_IN]: 'command.preview.zoomIn',
  [PREVIEW_ZOOM_OUT]: 'command.preview.zoomOut',
  [PREVIEW_ZOOM_FIT]: 'command.preview.zoomFit',
  [PREVIEW_NEXT_FORMAT]: 'command.preview.nextFormat',
  [PREVIEW_PREVIOUS_FORMAT]: 'command.preview.previousFormat',
  [PREVIEW_NEXT_SLIDE]: 'command.preview.nextSlide',
  [PREVIEW_PREVIOUS_SLIDE]: 'command.preview.previousSlide',
  [SHELL_TOGGLE_LOCALE]: 'command.shell.toggleLocale',
  [EDITOR_TOGGLE_VIM]: 'command.editor.toggleVim',
};

/**
 * What `main.ts` has to be able to do for the commands below to mean anything.
 *
 * A port and not the module's own state: every one of these moves something `main.ts`
 * holds — the zoom, the selected format, the locale — and taking them as functions is what
 * lets a test drive the whole registry without a window, a bridge or an editor.
 */
export interface DesktopActions {
  stepZoom(direction: 1 | -1): void;
  zoomToFit(): void;
  /** Wraps at the ends: a tab strip with two formats should cycle rather than stop. */
  stepFormat(direction: 1 | -1): void;
  stepSlide(direction: 1 | -1): void;
  toggleLocale(): void;
  toggleVimMode(): void;
}

/**
 * The registry, with the window's own commands in it.
 *
 * **None of them declares an `undo`**, and the registry would accept one: the field exists
 * for a command that changes something the document does not hold, which is exactly what a
 * zoom is. It is left off on purpose. `Mod-z` is one stack shared with the text, so a
 * declared undo would put "I zoomed in" between two keystrokes a person is trying to take
 * back — and an undo that sometimes moves the picture instead of the words is worse than no
 * undo at all for these. Changing the zoom back is one keystroke either way.
 *
 * Registration order is display order (`@tyto/editor`), so this reads top to bottom the way
 * the bar shows it: undo and redo arrive first, from `createCommandRegistry` itself.
 */
export function createDesktopRegistry(actions: DesktopActions): CommandRegistry {
  const registry = createCommandRegistry();

  const add = (id: string, run: () => void): void => {
    registry.register({ id, run });
  };

  add(PREVIEW_ZOOM_IN, () => {
    actions.stepZoom(1);
  });
  add(PREVIEW_ZOOM_OUT, () => {
    actions.stepZoom(-1);
  });
  add(PREVIEW_ZOOM_FIT, () => {
    actions.zoomToFit();
  });
  add(PREVIEW_NEXT_FORMAT, () => {
    actions.stepFormat(1);
  });
  add(PREVIEW_PREVIOUS_FORMAT, () => {
    actions.stepFormat(-1);
  });
  add(PREVIEW_NEXT_SLIDE, () => {
    actions.stepSlide(1);
  });
  add(PREVIEW_PREVIOUS_SLIDE, () => {
    actions.stepSlide(-1);
  });
  add(SHELL_TOGGLE_LOCALE, () => {
    actions.toggleLocale();
  });
  add(EDITOR_TOGGLE_VIM, () => {
    actions.toggleVimMode();
  });

  return registry;
}

/**
 * The keystroke a command answers to, written the way a person reads it.
 *
 * Read off the keymap set the editor is actually running, never a second table. That is the
 * card's requirement and it is also the only way the bar can be honest: a binding shown
 * beside a command has to be the one that works, and vim mode swaps the set under it —
 * undo is `u` there and belongs to the vim engine, so the set has no `Mod-z` and the bar
 * correctly shows none.
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
      .replace(/\bShift\b/gu, mac ? '⇧' : 'Shift')
      .replace(/\bAlt\b/gu, mac ? '⌥' : 'Alt')
      .replaceAll('-', mac ? '' : '+');
    // The first binding wins. A set may bind two keys to one command — redo has three —
    // and a person looking for the shortcut wants one of them, not a list.
    bindings[binding.command] ??= key;
  }

  return bindings;
}

/** The set that is interpreting the keys right now, which vim mode changes. */
export const keymapSetFor = (vim: boolean): EditorKeymap => (vim ? vimKeymapSet : defaultKeymapSet);
