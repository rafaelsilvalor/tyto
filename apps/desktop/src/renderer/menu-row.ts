import type { MenuModel, MenuMove } from '../../shared/ipc.js';

/** What opening a list answers: whether it opened, and which way an arrow left it (TYTO-263). */
export interface MenuOpened {
  readonly opened: boolean;
  readonly move?: MenuMove | undefined;
}

/**
 * The name beside `index` in a row of `count`, wrapping at both ends, as a menu bar does.
 *
 * One function for both doors: Left and Right on the row itself, and Left and Right inside an
 * open list, which main reports as a `move` (TYTO-263).
 */
export function neighbourOf(index: number, count: number, move: MenuMove): number {
  if (count <= 0) return 0;
  return move === 'next' ? (index + 1) % count : (index - 1 + count) % count;
}

/**
 * The menu row the window draws in its title bar (TYTO-244, ADR 0078).
 *
 * With the system's title bar hidden, Windows and Linux draw no native menu bar, and nothing
 * brings it back — measured in PR A. So the window draws the top-level names, in a row, and
 * **each name opens that menu's native list**: main pops up the very submenu it installed,
 * so every item runs as it always did — a role is Electron's, a File item is a command id —
 * and nothing here knows what any of them does. The list is the system's and does not follow
 * the theme; the row does.
 *
 * ARIA's menubar pattern: the container is `menubar`, each name a `menuitem` that says it has
 * a popup and whether it is open, and one name at a time is in the tab order (roving
 * tabindex). Left and Right move between names, Enter, Space and Down open the list, Escape
 * leaves the row for whatever had focus before it. Left and Right **inside** an open list
 * close it and open the neighbour's, on Windows, where main can hear them (TYTO-263).
 *
 * Alt and F10 are not here. They are keys of the whole window, so they live in its one
 * dispatcher (ADR 0074) and call {@link MenuRow.toggle}; {@link AltTap} is the part of that
 * which is a decision rather than a listener.
 */
export class MenuRow {
  private readonly container: HTMLElement;
  private readonly open: (id: string, at: { x: number; y: number }) => Promise<MenuOpened>;
  private buttons: HTMLButtonElement[] = [];
  private current = 0;
  /** What had focus before the row took it, so Escape can give it back. */
  private before: Element | null = null;

  constructor(
    container: HTMLElement,
    open: (id: string, at: { x: number; y: number }) => Promise<MenuOpened>,
  ) {
    this.container = container;
    this.open = open;
    container.setAttribute('role', 'menubar');
    // One listener for the row's life: the buttons are drawn again on a language change, and
    // a listener per button would have to be taken off each time.
    container.addEventListener('keydown', (event) => {
      this.keydown(event);
    });
    container.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest('button');
      if (button === null || button === undefined) return;
      const index = this.buttons.indexOf(button as HTMLButtonElement);
      if (index >= 0) void this.openAt(index);
    });
  }

  /** The names, drawn again from a new model. The name that held the tab stop keeps it. */
  draw(menus: readonly MenuModel[]): void {
    const keep = this.buttons[this.current]?.dataset['menuId'];
    const hadFocus = this.focused;
    this.buttons = menus.map((menu) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'title-bar__menu-item';
      button.textContent = menu.label;
      button.dataset['menuId'] = menu.id;
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      button.disabled = !menu.enabled;
      return button;
    });
    this.container.replaceChildren(...this.buttons);
    const kept = this.buttons.findIndex((button) => button.dataset['menuId'] === keep);
    this.rove(kept >= 0 ? kept : 0, hadFocus);
  }

  /** Whether focus is on one of the names. */
  get focused(): boolean {
    const active = document.activeElement;
    return active !== null && this.buttons.includes(active as HTMLButtonElement);
  }

  /** Alt and F10: into the row at its first name, or out of it if already there. */
  toggle(): boolean {
    if (this.buttons.length === 0) return false;
    if (this.focused) {
      this.leave();
      return true;
    }
    this.before = document.activeElement;
    this.rove(0, true);
    return true;
  }

  /** Back to what had focus before the row, or nowhere if that is gone. */
  leave(): void {
    const before = this.before;
    this.before = null;
    if (
      before instanceof HTMLElement &&
      before.isConnected &&
      !this.buttons.includes(before as HTMLButtonElement)
    ) {
      before.focus();
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private keydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = this.buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const last = this.buttons.length - 1;
    switch (event.key) {
      case 'ArrowRight':
        this.rove(neighbourOf(index, this.buttons.length, 'next'), true);
        break;
      case 'ArrowLeft':
        this.rove(neighbourOf(index, this.buttons.length, 'previous'), true);
        break;
      case 'Home':
        this.rove(0, true);
        break;
      case 'End':
        this.rove(last, true);
        break;
      // Enter and Space are the button's own: they click it, and the click opens the list.
      case 'ArrowDown':
        void this.openAt(index);
        break;
      case 'Escape':
        this.leave();
        break;
      default:
        return;
    }
    // Taken, so the window's dispatcher leaves it alone (ADR 0074) — Mod-K excepted, which
    // carries a modifier and never reaches this far.
    event.preventDefault();
  }

  /** Moves the one tab stop to `index`, and focus with it when asked. */
  private rove(index: number, focus: boolean): void {
    this.current = index;
    this.buttons.forEach((button, at) => {
      button.tabIndex = at === index ? 0 : -1;
    });
    if (focus) this.buttons[index]?.focus();
  }

  /**
   * Asks main for the native list under the name, and says it is open until it closes. A list
   * an arrow closed opens the neighbour's in its place, the way a menu bar walks (TYTO-263).
   */
  private async openAt(index: number): Promise<void> {
    const button = this.buttons[index];
    const id = button?.dataset['menuId'];
    if (button === undefined || id === undefined || button.disabled) return;
    if (this.before === null && !this.focused) this.before = document.activeElement;
    this.rove(index, true);
    const box = button.getBoundingClientRect();
    button.setAttribute('aria-expanded', 'true');
    let move: MenuMove | undefined;
    try {
      move = (await this.open(id, { x: box.left, y: box.bottom })).move;
    } finally {
      button.setAttribute('aria-expanded', 'false');
    }
    if (move !== undefined) await this.openAt(neighbourOf(index, this.buttons.length, move));
  }
}

/**
 * Alt pressed and released alone, which is what opens a menu bar on Windows and Linux.
 *
 * On the press it cannot know: Alt is also the start of every Alt+key the editor, vim or the
 * keybinding table owns, and taking focus on the press would hand that key to the row. So the
 * press **arms** and the release **fires**, and anything in between — another key, a mouse
 * button, the window losing focus — disarms. A press the editor already took
 * (`defaultPrevented`) never arms.
 */
export class AltTap {
  private armed = false;

  /** Every keydown in the window, before anything else reads it. */
  down(event: KeyboardEvent): void {
    // Alt held down repeats; the release after a long press is still a tap.
    if (event.key === 'Alt' && event.repeat) return;
    this.armed =
      event.key === 'Alt' &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.defaultPrevented;
  }

  /** Every keyup: `true` once, for the release of an Alt nothing else came between. */
  up(event: KeyboardEvent): boolean {
    const fire = this.armed && event.key === 'Alt';
    this.armed = false;
    return fire;
  }

  /** A mouse button or the window losing focus: the next release is not a tap. */
  reset(): void {
    this.armed = false;
  }
}
