import { COMMAND_BAR_TOGGLE, type Keybinding, bindingsOf } from '@tyto/editor';

import { type CatalogueKey, translate } from '../../../../apps/desktop/shared/i18n/index.js';
import {
  COMMAND_LABELS,
  DOCUMENT_SLOTS,
  type DesktopActions,
  builtInKeybindings,
  createDesktopRegistry,
  selectDocumentCommandId,
  slotOfSelectCommand,
} from '../../../../apps/desktop/src/renderer/commands.js';
import type { Locale } from './markdown.js';

/**
 * The window's commands and keys, read from the modules the window builds them from.
 *
 * `createDesktopRegistry` takes its actions as a port, so a registry built with actions that
 * do nothing lists exactly the ids the window's registry holds at startup, in the order the
 * command bar shows them — without a window, a bridge or an editor.
 */
const idleActions = new Proxy({} as DesktopActions, {
  get: () => () => undefined,
});

/**
 * The ids `main.ts` registers beside `createDesktopRegistry`, which cannot be imported without
 * a document. Only the ones that exist from the first frame and carry a default key: the nine
 * tab slots (`registerDocumentCommands`). The bar's own toggle is the resolver's, not the
 * registry's (`@tyto/editor`'s keybindings). A panel's toggle and a recent file's entry come
 * and go while the window runs, so the commands page names them in prose.
 */
const WINDOW_REGISTERED: readonly string[] = [
  COMMAND_BAR_TOGGLE,
  ...DOCUMENT_SLOTS.map(selectDocumentCommandId),
];

/** Every command id the window answers at startup, in the bar's order. */
export function windowCommandIds(): readonly string[] {
  return [
    ...createDesktopRegistry(idleActions)
      .list()
      .map((command) => command.id),
    ...WINDOW_REGISTERED,
  ];
}

/**
 * The bar's toggle has no command title, since the bar never lists itself; the status bar's
 * button that runs it has, in both languages.
 */
const COMMAND_BAR_TITLE: CatalogueKey = 'status.commandBar';

/** A command's title as the command bar shows it (`commandTitle` in `main.ts`). */
export function commandTitle(id: string, locale: Locale): string {
  const slot = slotOfSelectCommand(id);
  if (slot !== undefined) return `${translate(locale, 'command.document.select')}: ${String(slot)}`;
  if (id === COMMAND_BAR_TOGGLE) return translate(locale, COMMAND_BAR_TITLE);
  const key = COMMAND_LABELS[id];
  return key === undefined ? id : translate(locale, key);
}

/**
 * The built-in bindings whose command the window registers. A binding to an id nobody
 * registered does nothing when pressed, so the manual must not offer it; the test pins which
 * ones this drops, so a command that starts being registered puts its key back on the page.
 */
export function answeredKeybindings(): readonly Keybinding[] {
  const known = new Set(windowCommandIds());
  return builtInKeybindings.filter((binding) => known.has(binding.command));
}

export function unansweredKeybindings(): readonly Keybinding[] {
  const known = new Set(windowCommandIds());
  return builtInKeybindings.filter((binding) => !known.has(binding.command));
}

export type Platform = 'win32' | 'darwin';

/** A key as the command bar writes it on that platform: `Ctrl+Shift+s`, or `⌘⇧s`. */
export function keyLabel(binding: Pick<Keybinding, 'key' | 'mac'>, platform: Platform): string {
  const one = {
    key: binding.key,
    command: 'key',
    ...(binding.mac === undefined ? {} : { mac: binding.mac }),
  };
  return bindingsOf({ id: 'key', bindings: [one] }, platform)['key'] ?? binding.key;
}
