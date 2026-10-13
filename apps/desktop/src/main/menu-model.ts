import type { MenuItemModel, MenuModel } from '../../shared/ipc.js';

/**
 * The installed application menu, projected into what the window draws (TYTO-244, ADR 0078).
 *
 * With the system's title bar hidden, Windows and Linux draw no native menu bar, so the window
 * draws a row of the top-level names and each name opens that menu's **native** list. This
 * file is the one half of that which is pure: it reads a menu shaped like Electron's and
 * answers a serialisable model, and finds a top-level menu again by the id it gave it.
 *
 * Structural types and not `Electron.MenuItem`, so a test builds a menu out of plain objects
 * and no Electron runs under it. A real `MenuItem` satisfies them.
 */
export interface MenuItemLike {
  readonly id?: string | null;
  readonly label?: string | null;
  readonly role?: string | null;
  readonly type?: string | null;
  readonly enabled?: boolean;
  readonly visible?: boolean;
  readonly accelerator?: string | null;
  readonly submenu?: MenuLike | null;
  /**
   * Electron's key for a role item. A role carries its accelerator without writing it on
   * `accelerator`, so this is the only way to show `Ctrl+Shift+I` beside the developer tools.
   * Optional because it is not in Electron's typings; absent, the item shows no key.
   */
  readonly getDefaultRoleAccelerator?: () => string | null | undefined;
}

export interface MenuLike {
  readonly items: readonly MenuItemLike[];
}

const ITEM_TYPES = new Set<MenuItemModel['type']>([
  'normal',
  'separator',
  'submenu',
  'checkbox',
  'radio',
]);

/**
 * A top-level menu's id: the template's own when it gave one (File is `file`), the role's when
 * it is a role (`editmenu`, `help`), and its position otherwise. The same function finds it
 * again in {@link findTopLevel}, so the id only has to agree with itself.
 */
export function topLevelId(item: MenuItemLike, index: number): string {
  if (typeof item.id === 'string' && item.id !== '') return item.id;
  if (typeof item.role === 'string' && item.role !== '') return item.role.toLowerCase();
  return `menu-${String(index)}`;
}

/**
 * The label without its mnemonic marker: `&File` reads `File`, and `&&` is a literal `&`.
 */
export function withoutMnemonic(label: string): string {
  return label.replace(/&(&?)/g, (_match, literal: string) => literal);
}

/** A label as the row draws it, and the letter Alt opens it with, if it has one. */
export interface Mnemonic {
  readonly label: string;
  /** The character after the first single `&`, as written: `x` for `E&xibir`. */
  readonly mnemonic?: string;
  /** Where that character sits in {@link Mnemonic.label}, so the row can underline it. */
  readonly mnemonicAt?: number;
}

/**
 * `E&xibir` → `Exibir`, `x` at 1 (TYTO-264, ADR 0078). The first single `&` marks the letter, as
 * Windows reads it; `&&` is a literal `&` and marks nothing, and a trailing `&` marks nothing.
 */
export function mnemonicOf(written: string): Mnemonic {
  let label = '';
  let found: { mnemonic: string; mnemonicAt: number } | undefined;
  for (let index = 0; index < written.length; index += 1) {
    const char = written[index]!;
    if (char !== '&') {
      label += char;
      continue;
    }
    const next = written[index + 1];
    index += 1;
    if (next === undefined) break;
    if (next !== '&' && found === undefined) found = { mnemonic: next, mnemonicAt: label.length };
    label += next;
  }
  return found === undefined ? { label } : { label, ...found };
}

/** An Electron accelerator as a person reads it on this platform: `Ctrl+Shift+I`. */
export function acceleratorLabel(accelerator: string, platform: string): string {
  const mac = platform === 'darwin';
  return accelerator
    .split('+')
    .map((part) => {
      switch (part.toLowerCase()) {
        case 'commandorcontrol':
        case 'cmdorctrl':
          return mac ? 'Cmd' : 'Ctrl';
        case 'control':
        case 'ctrl':
          return 'Ctrl';
        case 'command':
        case 'cmd':
          return 'Cmd';
        case 'option':
        case 'alt':
          return mac ? 'Option' : 'Alt';
        case 'plus':
          return '+';
        default:
          return part;
      }
    })
    .join('+');
}

function itemType(item: MenuItemLike): MenuItemModel['type'] {
  const type = item.type ?? (item.submenu ? 'submenu' : 'normal');
  return ITEM_TYPES.has(type as MenuItemModel['type']) ? (type as MenuItemModel['type']) : 'normal';
}

function shownAccelerator(item: MenuItemLike, platform: string): string | undefined {
  const raw =
    typeof item.accelerator === 'string' && item.accelerator !== ''
      ? item.accelerator
      : item.getDefaultRoleAccelerator?.();
  return typeof raw === 'string' && raw !== '' ? acceleratorLabel(raw, platform) : undefined;
}

function projectItem(item: MenuItemLike, index: number, platform: string): MenuItemModel {
  const type = itemType(item);
  const role = typeof item.role === 'string' && item.role !== '' ? item.role.toLowerCase() : '';
  const accelerator = type === 'separator' ? undefined : shownAccelerator(item, platform);
  return {
    id: typeof item.id === 'string' && item.id !== '' ? item.id : `item-${String(index)}`,
    label: type === 'separator' ? '' : withoutMnemonic(item.label ?? ''),
    type,
    ...(role === '' ? {} : { role }),
    enabled: item.enabled !== false,
    ...(accelerator === undefined ? {} : { accelerator }),
  };
}

/**
 * The model of a menu: one entry per visible top-level item that holds a submenu, each with
 * its visible items. A top-level item with no submenu has nothing to open, so it is not drawn.
 */
export function projectMenu(menu: MenuLike | null, platform: string): MenuModel[] {
  if (menu === null) return [];
  const models: MenuModel[] = [];
  menu.items.forEach((item, index) => {
    if (item.visible === false || !item.submenu) return;
    const role = typeof item.role === 'string' && item.role !== '' ? item.role.toLowerCase() : '';
    models.push({
      id: topLevelId(item, index),
      // The label and its letter: the row draws the one and underlines the other (TYTO-264).
      ...mnemonicOf(item.label ?? ''),
      ...(role === '' ? {} : { role }),
      enabled: item.enabled !== false,
      items: item.submenu.items
        .filter((child) => child.visible !== false)
        .map((child, childIndex) => projectItem(child, childIndex, platform)),
    });
  });
  return models;
}

/** The top-level menu `id` names in `menu`, or nothing — the same ids {@link projectMenu} gave. */
export function findTopLevel(menu: MenuLike | null, id: string): MenuItemLike | undefined {
  if (menu === null) return undefined;
  return menu.items.find((item, index) => topLevelId(item, index) === id);
}
