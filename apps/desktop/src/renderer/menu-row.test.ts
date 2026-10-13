// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MenuModel } from '../../shared/ipc.js';
import { AltTap, MenuRow, type MenuOpened, neighbourOf } from './menu-row.js';

/**
 * The drawn menu row (TYTO-244, ADR 0078) in jsdom: its names, its ARIA, and its keys.
 *
 * jsdom does no layout, so where the native list opens is a rectangle of zeros here; the
 * point main is handed is asserted against a real window in `e2e/menu-row.desktop.test.ts`.
 */

const menu = (id: string, label: string, enabled = true): MenuModel => ({
  id,
  label,
  enabled,
  items: [],
});

const FIVE = [
  menu('file', 'File'),
  menu('editmenu', 'Edit'),
  menu('viewmenu', 'View'),
  menu('windowmenu', 'Window'),
  menu('help', 'Help'),
];

let container: HTMLElement;
let editor: HTMLTextAreaElement;
let opened: { id: string; at: { x: number; y: number } }[];
let close: ((answer?: MenuOpened) => void) | undefined;
let row: MenuRow;

const names = (): HTMLButtonElement[] => [...container.querySelectorAll('button')];
const focusedName = (): string | undefined =>
  (document.activeElement as HTMLElement | null)?.dataset['menuId'];
const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  document.activeElement?.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  document.body.innerHTML = '<div class="title-bar__menu"></div><textarea></textarea>';
  container = document.querySelector('.title-bar__menu')!;
  editor = document.querySelector('textarea')!;
  opened = [];
  close = undefined;
  row = new MenuRow(container, (id, at) => {
    opened.push({ id, at });
    return new Promise<MenuOpened>((resolve) => {
      close = (answer = { opened: true }) => {
        resolve(answer);
      };
    });
  });
  row.draw(FIVE);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the menu row', () => {
  it("draws one name per top-level menu, in the model's order, as a menubar", () => {
    expect(container.getAttribute('role')).toBe('menubar');
    expect(names().map((button) => button.textContent)).toEqual([
      'File',
      'Edit',
      'View',
      'Window',
      'Help',
    ]);
    for (const button of names()) {
      expect(button.getAttribute('role')).toBe('menuitem');
      expect(button.getAttribute('aria-haspopup')).toBe('menu');
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('keeps one name in the tab order', () => {
    expect(names().map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it('takes focus at the first name, and gives it back on Escape', () => {
    editor.focus();
    expect(row.toggle()).toBe(true);
    expect(focusedName()).toBe('file');
    press('Escape');
    expect(document.activeElement).toBe(editor);
  });

  it('leaves the row when toggled from inside it', () => {
    editor.focus();
    row.toggle();
    row.toggle();
    expect(document.activeElement).toBe(editor);
  });

  it('moves between names with Left and Right, wrapping, and with Home and End', () => {
    row.toggle();
    press('ArrowRight');
    expect(focusedName()).toBe('editmenu');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(focusedName()).toBe('help');
    press('ArrowRight');
    expect(focusedName()).toBe('file');
    press('End');
    expect(focusedName()).toBe('help');
    press('Home');
    expect(focusedName()).toBe('file');
    expect(names().map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it('takes the keys it answers, so the window dispatcher leaves them', () => {
    row.toggle();
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(press('x').defaultPrevented).toBe(false);
    expect(press('ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
  });

  it('opens the native list of the name with Down, and is expanded until it closes', async () => {
    row.toggle();
    press('End');
    press('ArrowDown');
    expect(opened.map(({ id }) => id)).toEqual(['help']);
    const help = names()[4]!;
    expect(help.getAttribute('aria-expanded')).toBe('true');
    close?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(help.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the neighbour when an arrow closed the list, wrapping at both ends (TYTO-263)', async () => {
    const settle = async (): Promise<void> => {
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    };
    names()[4]!.click();
    close?.({ opened: true, move: 'previous' });
    await settle();
    expect(opened.map(({ id }) => id)).toEqual(['help', 'windowmenu']);
    expect(names()[4]!.getAttribute('aria-expanded')).toBe('false');
    expect(names()[3]!.getAttribute('aria-expanded')).toBe('true');
    expect(focusedName()).toBe('windowmenu');

    close?.({ opened: true, move: 'next' });
    await settle();
    close?.({ opened: true, move: 'next' });
    await settle();
    expect(opened.map(({ id }) => id)).toEqual(['help', 'windowmenu', 'help', 'file']);
    expect(focusedName()).toBe('file');

    close?.({ opened: true, move: 'previous' });
    await settle();
    expect(opened.at(-1)?.id).toBe('help');
    close?.();
    await settle();
    expect(opened).toHaveLength(5);
    expect(names().map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('opens the list of the name that was clicked, and Enter clicks it', () => {
    names()[2]!.click();
    expect(opened.map(({ id }) => id)).toEqual(['viewmenu']);
    expect(focusedName()).toBe('viewmenu');
  });

  it('opens nothing for a disabled menu', () => {
    row.draw([menu('file', 'File'), menu('help', 'Help', false)]);
    names()[1]!.click();
    expect(opened).toEqual([]);
    expect(names()[1]!.disabled).toBe(true);
  });

  it('draws again in another language and keeps the tab stop on the same menu', () => {
    row.toggle();
    press('ArrowRight');
    row.draw([menu('file', 'Arquivo'), menu('editmenu', 'Editar'), menu('help', 'Ajuda')]);
    expect(names().map((button) => button.textContent)).toEqual(['Arquivo', 'Editar', 'Ajuda']);
    expect(names().map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
    expect(focusedName()).toBe('editmenu');
  });

  it('does nothing on Alt or F10 with no menu to show', () => {
    row.draw([]);
    expect(row.toggle()).toBe(false);
  });
});

describe('Alt pressed alone', () => {
  const key = (type: 'keydown' | 'keyup', name: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent(type, { key: name, cancelable: true, ...init });

  it('fires on the release of an Alt nothing came between', () => {
    const tap = new AltTap();
    tap.down(key('keydown', 'Alt', { altKey: true }));
    expect(tap.up(key('keyup', 'Alt'))).toBe(true);
    // Once: a second release with no press is not a tap.
    expect(tap.up(key('keyup', 'Alt'))).toBe(false);
  });

  it('keeps a long press a tap', () => {
    const tap = new AltTap();
    tap.down(key('keydown', 'Alt', { altKey: true }));
    tap.down(key('keydown', 'Alt', { altKey: true, repeat: true }));
    expect(tap.up(key('keyup', 'Alt'))).toBe(true);
  });

  it('leaves Alt+key to whoever owns it', () => {
    const tap = new AltTap();
    tap.down(key('keydown', 'Alt', { altKey: true }));
    tap.down(key('keydown', 'j', { altKey: true }));
    expect(tap.up(key('keyup', 'j', { altKey: true }))).toBe(false);
    expect(tap.up(key('keyup', 'Alt'))).toBe(false);
  });

  it('is not Ctrl+Alt (AltGr), Shift+Alt, or an Alt the editor took', () => {
    const tap = new AltTap();
    tap.down(key('keydown', 'Alt', { altKey: true, ctrlKey: true }));
    expect(tap.up(key('keyup', 'Alt'))).toBe(false);
    tap.down(key('keydown', 'Alt', { altKey: true, shiftKey: true }));
    expect(tap.up(key('keyup', 'Alt'))).toBe(false);
    const taken = key('keydown', 'Alt', { altKey: true });
    taken.preventDefault();
    tap.down(taken);
    expect(tap.up(key('keyup', 'Alt'))).toBe(false);
  });

  it('is disarmed by a mouse button or the window losing focus', () => {
    const tap = new AltTap();
    tap.down(key('keydown', 'Alt', { altKey: true }));
    tap.reset();
    expect(tap.up(key('keyup', 'Alt'))).toBe(false);
  });
});

describe('the neighbour of a menu (TYTO-263)', () => {
  it('is the next or the previous name, wrapping at both ends', () => {
    expect(neighbourOf(4, 5, 'previous')).toBe(3);
    expect(neighbourOf(0, 5, 'previous')).toBe(4);
    expect(neighbourOf(4, 5, 'next')).toBe(0);
    expect(neighbourOf(1, 5, 'next')).toBe(2);
  });

  it('stays put in a row of one, and answers 0 for an empty row', () => {
    expect(neighbourOf(0, 1, 'next')).toBe(0);
    expect(neighbourOf(0, 1, 'previous')).toBe(0);
    expect(neighbourOf(0, 0, 'next')).toBe(0);
  });
});
