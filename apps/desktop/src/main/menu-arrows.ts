import type { MenuMove } from '../../shared/ipc.js';

/**
 * Left and Right inside an open menu list move to the neighbouring menu (TYTO-263, ADR 0078).
 *
 * The drawn row opens each top-level menu's **native** list with `Menu.popup`. A real menu bar
 * on Windows moves to the next menu when Left or Right is pressed inside an open list; a list
 * popped on its own does not, because nothing tells it there is a bar beside it. Measured on
 * Electron 44.4.5 with real key presses: while the list is open, `before-input-event`, the
 * page's `keydown`, `menu-will-close` and the `popup` callback see nothing of either arrow —
 * but the window's own `WM_KEYDOWN`, read with `hookWindowMessage`, does. So on Windows, and
 * only while a list is open, main listens there, closes the list on an arrow, and answers the
 * window which way to go; the window opens the neighbour, which is a decision about its row and
 * so stays the window's.
 *
 * `hookWindowMessage` exists only on Windows, and `globalShortcut` would take the arrows from
 * every other application while a list is open, so Linux keeps the list as it is.
 */

/** `WM_KEYDOWN`: a key without Alt, sent to the window that has the keyboard. */
export const WM_KEYDOWN = 0x0100;
const VK_LEFT = 0x25;
const VK_RIGHT = 0x27;

/**
 * How long after an arrow moved the menu its own key press may still reach the page.
 *
 * The hook reads the message; it does not take it. Once the list is closed the same press is
 * delivered to the page as an ordinary `ArrowLeft` or `ArrowRight` — measured — where the row
 * would move focus a second time and the editor would move its cursor. So main swallows **the
 * next one arrow press, within this long**, and nothing else. A bound in time and not "until
 * the next list opens": the window opens the neighbour as soon as it has the answer, and a
 * leaked press that arrived after that would otherwise wait for a key the person really meant.
 */
export const LEAKED_ARROW_MS = 500;

/** The part of a `BrowserWindow` this needs, so a test can hand in a fake one. */
export interface ArrowWindow {
  hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void;
  unhookWindowMessage(message: number): void;
}

/** The part of a `Menu` this needs: the list it pops and the way to close it. */
export interface PoppableMenu<Window> {
  popup(options: { window: Window; x: number; y: number; callback: () => void }): void;
  closePopup(window: Window): void;
}

/** Which way an arrow's virtual-key code moves, or nothing for any other key. */
export function moveForKey(wParam: Buffer): MenuMove | undefined {
  // `wParam` is a pointer-sized integer; the virtual-key code is its low word.
  if (wParam.length < 4) return undefined;
  const key = wParam.readUInt32LE(0);
  if (key === VK_LEFT) return 'previous';
  if (key === VK_RIGHT) return 'next';
  return undefined;
}

/** The arrow press that reaches the page after it already moved the menu, swallowed once. */
export class LeakedArrow {
  private until = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** An arrow just moved the menu: its press may still reach the page. */
  expect(): void {
    this.until = this.now() + LEAKED_ARROW_MS;
  }

  /** For `before-input-event`: `true` once, for that press, which the caller then prevents. */
  take(input: { type: string; key: string }): boolean {
    if (input.type !== 'keyDown') return false;
    if (input.key !== 'ArrowLeft' && input.key !== 'ArrowRight') return false;
    if (this.until === 0 || this.now() > this.until) return false;
    this.until = 0;
    return true;
  }
}

/**
 * Pops `menu`'s native list and settles when it closes, with the way an arrow moved if one
 * closed it. On any platform but Windows it is `popup` and nothing more.
 */
export function popupWithArrows<Window extends ArrowWindow>(options: {
  readonly menu: PoppableMenu<Window>;
  readonly window: Window;
  readonly at: { readonly x: number; readonly y: number };
  readonly platform: NodeJS.Platform;
  readonly leaked: LeakedArrow;
}): Promise<{ opened: true; move?: MenuMove }> {
  const { menu, window, at, platform, leaked } = options;
  return new Promise((resolve) => {
    let move: MenuMove | undefined;
    const watching = platform === 'win32';
    if (watching) {
      window.hookWindowMessage(WM_KEYDOWN, (wParam) => {
        // A held arrow repeats before the list has gone; the first one decides.
        if (move !== undefined) return;
        const found = moveForKey(wParam);
        if (found === undefined) return;
        move = found;
        // Armed here and not in the callback: the press may reach the page before it runs.
        leaked.expect();
        menu.closePopup(window);
      });
    }
    menu.popup({
      window,
      x: at.x,
      y: at.y,
      // Every way the list closes comes through here — an item, Escape, a click away, an
      // arrow — so the hook never outlives the list it was for.
      callback: () => {
        if (watching) window.unhookWindowMessage(WM_KEYDOWN);
        resolve(move === undefined ? { opened: true } : { opened: true, move });
      },
    });
  });
}
