import { describe, expect, it } from 'vitest';

import {
  type ArrowWindow,
  LEAKED_ARROW_MS,
  LeakedArrow,
  type PoppableMenu,
  WM_KEYDOWN,
  moveForKey,
  popupWithArrows,
} from './menu-arrows.js';

/**
 * Left and Right inside an open native list (TYTO-263, ADR 0078), against a fake window and a
 * fake menu: the real `hookWindowMessage` exists only on Windows and the real `popup` runs a
 * modal loop, so this is what the Linux CI can run of the mechanism.
 */

/** A pointer-sized `wParam` holding one virtual-key code, as Windows hands it to the hook. */
const key = (code: number): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(code, 0);
  return buffer;
};

const LEFT = key(0x25);
const RIGHT = key(0x27);
const DOWN = key(0x28);

class FakeWindow implements ArrowWindow {
  readonly hooks = new Map<number, (wParam: Buffer, lParam: Buffer) => void>();
  readonly log: string[] = [];

  hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void {
    this.log.push(`hook ${String(message)}`);
    this.hooks.set(message, callback);
  }

  unhookWindowMessage(message: number): void {
    this.log.push(`unhook ${String(message)}`);
    this.hooks.delete(message);
  }

  /** The window receiving a key press while the list is open. */
  press(wParam: Buffer): void {
    this.hooks.get(WM_KEYDOWN)?.(wParam, Buffer.alloc(8));
  }
}

class FakeMenu implements PoppableMenu<FakeWindow> {
  callback: (() => void) | undefined;
  readonly log: string[] = [];

  popup(options: { window: FakeWindow; x: number; y: number; callback: () => void }): void {
    this.log.push(`popup ${String(options.x)},${String(options.y)}`);
    this.callback = options.callback;
  }

  closePopup(): void {
    this.log.push('closePopup');
    // The real list's callback runs once its loop has ended; here, at once.
    this.close();
  }

  /** The list closing any way at all: an item, Escape, a click away. */
  close(): void {
    const callback = this.callback;
    this.callback = undefined;
    callback?.();
  }
}

const open = (platform: NodeJS.Platform, leaked = new LeakedArrow()) => {
  const window = new FakeWindow();
  const menu = new FakeMenu();
  const answer = popupWithArrows({ menu, window, at: { x: 10, y: 33 }, platform, leaked });
  return { window, menu, answer, leaked };
};

describe('the arrows inside an open list (TYTO-263)', () => {
  it('reads Left as previous and Right as next, and nothing else as a move', () => {
    expect(moveForKey(LEFT)).toBe('previous');
    expect(moveForKey(RIGHT)).toBe('next');
    expect(moveForKey(DOWN)).toBeUndefined();
    expect(moveForKey(Buffer.alloc(2))).toBeUndefined();
  });

  it('closes the list on Left and answers which way, on Windows', async () => {
    const { window, menu, answer } = open('win32');
    expect(window.log).toEqual([`hook ${String(WM_KEYDOWN)}`]);
    window.press(LEFT);
    expect(await answer).toEqual({ opened: true, move: 'previous' });
    expect(menu.log).toEqual(['popup 10,33', 'closePopup']);
    expect(window.log).toEqual([`hook ${String(WM_KEYDOWN)}`, `unhook ${String(WM_KEYDOWN)}`]);
  });

  it('answers next on Right', async () => {
    const { window, answer } = open('win32');
    window.press(RIGHT);
    expect(await answer).toEqual({ opened: true, move: 'next' });
  });

  it('leaves every other key to the list, and unhooks however the list closes', async () => {
    const { window, menu, answer } = open('win32');
    window.press(DOWN);
    expect(menu.log).toEqual(['popup 10,33']);
    menu.close();
    expect(await answer).toEqual({ opened: true });
    expect(window.hooks.size).toBe(0);
  });

  it('lets the first arrow decide when a held one repeats before the list has gone', async () => {
    const window = new FakeWindow();
    const menu = new FakeMenu();
    // A list whose loop has not ended yet when the next press arrives.
    menu.closePopup = () => {
      menu.log.push('closePopup');
    };
    const answer = popupWithArrows({
      menu,
      window,
      at: { x: 0, y: 0 },
      platform: 'win32',
      leaked: new LeakedArrow(),
    });
    window.press(LEFT);
    window.press(RIGHT);
    menu.close();
    expect(await answer).toEqual({ opened: true, move: 'previous' });
    expect(menu.log.filter((entry) => entry === 'closePopup')).toHaveLength(1);
  });

  it('hooks nothing on Linux or macOS', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const { window, menu, answer } = open(platform);
      window.press(LEFT);
      expect(window.log).toEqual([]);
      menu.close();
      expect(await answer).toEqual({ opened: true });
    }
  });

  it('expects the leaked press as soon as an arrow moves the menu', () => {
    const { window, leaked } = open('win32');
    window.press(RIGHT);
    expect(leaked.take({ type: 'keyDown', key: 'ArrowRight' })).toBe(true);
  });
});

describe('the arrow press that leaks to the page (TYTO-263)', () => {
  const clock = () => {
    let now = 1_000;
    return {
      now: () => now,
      advance: (ms: number) => {
        now += ms;
      },
    };
  };

  it('swallows nothing until an arrow has moved a menu', () => {
    const leaked = new LeakedArrow(clock().now);
    expect(leaked.take({ type: 'keyDown', key: 'ArrowLeft' })).toBe(false);
  });

  it('swallows the next arrow press once, and only that one', () => {
    const leaked = new LeakedArrow(clock().now);
    leaked.expect();
    expect(leaked.take({ type: 'keyUp', key: 'ArrowLeft' })).toBe(false);
    expect(leaked.take({ type: 'keyDown', key: 'a' })).toBe(false);
    expect(leaked.take({ type: 'keyDown', key: 'ArrowLeft' })).toBe(true);
    expect(leaked.take({ type: 'keyDown', key: 'ArrowLeft' })).toBe(false);
  });

  it(`stops expecting it after ${String(LEAKED_ARROW_MS)} ms`, () => {
    const time = clock();
    const leaked = new LeakedArrow(time.now);
    leaked.expect();
    time.advance(LEAKED_ARROW_MS + 1);
    expect(leaked.take({ type: 'keyDown', key: 'ArrowRight' })).toBe(false);
  });
});
