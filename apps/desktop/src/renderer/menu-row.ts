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

/** The modifiers of a keydown, which is all {@link isMenuLetterStroke} reads. */
export interface LetterStroke {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Whether a keydown could be Alt and a menu's letter (TYTO-264): Alt, a single character, and
 * neither Ctrl nor Meta. **AltGr arrives as Ctrl+Alt** on Windows — ABNT2 types `/`, `?` and `°`
 * with it — so a Ctrl in the stroke is a character being typed, never a menu.
 */
export function isMenuLetterStroke(stroke: LetterStroke): boolean {
  return stroke.altKey && !stroke.ctrlKey && !stroke.metaKey && [...stroke.key].length === 1;
}

/**
 * The letters the keybinding table already holds with Alt, from its keys as `concreteKey` spells
 * them (`Alt-f`). **The table wins** (TYTO-264, ADR 0078): a person or a plugin who bound
 * Alt+F meant it, so that letter opens no menu and its name shows no underline — in every
 * context, because an underline cannot say "except in the editor".
 */
export function altLettersTaken(keys: Iterable<string>): ReadonlySet<string> {
  const taken = new Set<string>();
  for (const key of keys) {
    const letter = /^Alt-(.)$/u.exec(key)?.[1];
    if (letter !== undefined) taken.add(letter.toLowerCase());
  }
  return taken;
}

/**
 * The menu whose letter `key` is, compared without case against the labels the row has now —
 * the current language's, so a language switch needs no restart. A disabled menu and a letter
 * the table holds open nothing.
 */
export function menuForLetter(
  menus: readonly Pick<MenuModel, 'id' | 'mnemonic' | 'enabled'>[],
  key: string,
  taken: ReadonlySet<string>,
): string | undefined {
  const letter = key.toLowerCase();
  if (taken.has(letter)) return undefined;
  return menus.find((menu) => menu.enabled && menu.mnemonic?.toLowerCase() === letter)?.id;
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
 * Alt, Alt+letter and F10 are not here. They are keys of the whole window, so they live in its
 * one dispatcher (ADR 0074) and call {@link MenuRow.toggle} and {@link MenuRow.openByLetter};
 * {@link AltTap} is the part of that which is a decision rather than a listener.
 *
 * **Each name underlines its letter only while Alt is held, or while the row has focus because
 * a key put it there** (TYTO-264), as Windows does: `data-mnemonics` on the container, which
 * the dispatcher sets with {@link MenuRow.showMnemonics}.
 */
export class MenuRow {
  private readonly container: HTMLElement;
  private readonly open: (id: string, at: { x: number; y: number }) => Promise<MenuOpened>;
  private buttons: HTMLButtonElement[] = [];
  private menus: readonly MenuModel[] = [];
  private current = 0;
  /** Whether a key — Alt, F10, Alt+letter — and not the mouse put focus in the row. */
  private byKey = false;
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
    // Focus leaving the row ends a keyboard visit, and the underlines with it.
    container.addEventListener('focusout', (event) => {
      if (this.buttons.includes(event.relatedTarget as HTMLButtonElement)) return;
      this.byKey = false;
      this.showMnemonics(false);
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
    this.menus = menus;
    this.buttons = menus.map((menu) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'title-bar__menu-item';
      button.append(...labelNodes(menu));
      button.dataset['menuId'] = menu.id;
      if (menu.mnemonic !== undefined) button.dataset['mnemonic'] = menu.mnemonic.toLowerCase();
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
    this.byKey = true;
    this.rove(0, true);
    return true;
  }

  /**
   * Alt and a letter: opens the menu whose letter it is, as a click on its name would, and
   * answers whether there was one. The table's letters are `taken` and open nothing.
   */
  openByLetter(key: string, taken: ReadonlySet<string>): boolean {
    const id = menuForLetter(this.menus, key, taken);
    const index = this.buttons.findIndex((button) => button.dataset['menuId'] === id);
    if (id === undefined || index < 0) return false;
    this.byKey = true;
    this.showMnemonics(true, taken);
    void this.openAt(index);
    return true;
  }

  /**
   * Underlines each name's letter, or stops. Off is refused while a key holds the row, which is
   * Alt's release after Alt alone put it there. A letter the table holds is not underlined.
   */
  showMnemonics(on: boolean, taken: ReadonlySet<string> = new Set()): void {
    if (!on && this.byKey && this.focused) return;
    if (!on) {
      delete this.container.dataset['mnemonics'];
      return;
    }
    this.container.dataset['mnemonics'] = 'shown';
    for (const button of this.buttons) {
      const letter = button.dataset['mnemonic'];
      button.toggleAttribute('data-mnemonic-taken', letter !== undefined && taken.has(letter));
    }
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

/** A name's text, with its letter in a span the stylesheet underlines while Alt is held. */
function labelNodes(menu: MenuModel): (string | HTMLElement)[] {
  const at = menu.mnemonicAt;
  if (at === undefined || at >= menu.label.length) return [menu.label];
  const letter = document.createElement('span');
  letter.className = 'title-bar__mnemonic';
  letter.textContent = menu.label.slice(at, at + 1);
  return [menu.label.slice(0, at), letter, menu.label.slice(at + 1)].filter((node) => node !== '');
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
