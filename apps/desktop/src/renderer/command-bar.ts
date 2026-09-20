import { LitElement, type TemplateResult, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { type Locale, DEFAULT_LOCALE, translate } from '../../shared/i18n/index.js';

/**
 * The command bar: everything the window can do, in one list, reachable by typing (E9.12).
 *
 * The second Lit element in the renderer (ADR 0024) and the one that shows why the ADR was
 * worth having: a palette is a filtered list that rewrites itself on every keystroke, which
 * is the shape `replaceChildren` is worst at and keyed `repeat` is best at.
 *
 * **It holds no state about the app and runs nothing itself.** It is given a list of
 * entries and two callbacks. What a command *does* lives in the registry, which is the
 * whole point of the registry — the bar and a key binding both reach it by id, so they
 * cannot drift apart.
 */

export const COMMAND_BAR_TAG = 'tyto-command-bar';

export interface CommandEntry {
  readonly id: string;
  /** Already translated by the caller, which is what the filter matches against. */
  readonly label: string;
  /** The keystroke, or nothing for a command no set binds. */
  readonly binding?: string;
}

/**
 * Loose matching, because a person types what they remember rather than what is written.
 *
 * Accents folded and case ignored, so `previa` finds "Prévia: aumentar" — on a Portuguese
 * keyboard the accent is two keystrokes and nobody types it into a search box. The id is
 * matched as well as the label, which is how `preview.zoomIn` finds it in either language.
 */
const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function filterCommands(
  entries: readonly CommandEntry[],
  query: string,
): readonly CommandEntry[] {
  const needle = fold(query.trim());
  if (needle === '') return entries;
  return entries.filter(
    (entry) => fold(entry.label).includes(needle) || fold(entry.id).includes(needle),
  );
}

export class CommandBar extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    commands: { attribute: false },
    locale: { attribute: false },
    run: { attribute: false },
    close: { attribute: false },
    query: { state: true },
    active: { state: true },
  };

  declare open: boolean;
  declare commands: readonly CommandEntry[];
  declare locale: Locale;
  /**
   * Called with the id of the chosen command. Closing afterwards is the caller's call.
   *
   * **It answers whether the command actually ran** (TYTO-154). The registry already knows —
   * `runCommand` returns `false` for a window whose editor is not mounted yet, which is the
   * right answer to a click on something that cannot work and was, until this card, thrown
   * away at this line. A person clicking has nothing to do with the answer; a test driving
   * the bar has, and a refusal that looks identical to success is what made
   * `e2e/export.desktop.test.ts` wait thirty seconds for a command nobody ever ran.
   */
  declare run: (id: string) => boolean;
  declare close: () => void;

  /** What has been typed. Cleared on every open, so the bar never remembers last time. */
  declare query: string;
  /** Index into the *filtered* list. Reset to the top on every keystroke, never clamped. */
  declare active: number;

  /** Where focus was when the bar opened, so Escape can put it back. */
  private returnFocusTo: HTMLElement | undefined;

  constructor() {
    super();
    this.open = false;
    this.commands = [];
    this.locale = DEFAULT_LOCALE;
    this.run = () => false;
    this.close = () => undefined;
    this.query = '';
    this.active = 0;
  }

  /** Light DOM, so `shell.css` styles it — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  get visible(): readonly CommandEntry[] {
    return filterCommands(this.commands, this.query);
  }

  /**
   * Opens the bar, clearing what was typed last time and remembering where focus was.
   *
   * A method and not a watcher on the property, because the caller has to be able to say
   * "open" without the bar having to guess whether this is a new opening or a re-render.
   */
  show(): void {
    const active = this.ownerDocument.activeElement;
    this.returnFocusTo = active instanceof HTMLElement ? active : undefined;
    this.query = '';
    this.active = 0;
    this.open = true;
  }

  /** Closes and puts focus back where it was, which is the half a person notices. */
  dismiss(): void {
    this.open = false;
    this.returnFocusTo?.focus();
    this.returnFocusTo = undefined;
    this.close();
  }

  private choose(id: string): void {
    // Closed **before** the command runs, and focus restored first: a command that moves
    // the cursor or toggles vim needs the editor focused, and running it under an open
    // overlay would put the effect behind the thing covering it.
    this.dismiss();
    this.run(id);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const visible = this.visible;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismiss();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (visible.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // Wraps, because a list this short is a ring: pressing up at the top means "the last
      // one", not "nothing happens".
      this.active = (this.active + step + visible.length) % visible.length;
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = visible[this.active];
      if (chosen !== undefined) this.choose(chosen.id);
    }
  }

  private onInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.query = input.value;
    // Back to the top on every keystroke: the best match is first, and a selection left
    // pointing at row four of a list that just shrank to two is how a palette runs the
    // wrong command.
    this.active = 0;
  }

  protected override updated(): void {
    if (!this.open) return;
    const input = this.querySelector<HTMLInputElement>('.command-bar__input');
    if (input !== null && this.ownerDocument.activeElement !== input) input.focus();
  }

  private option(entry: CommandEntry, index: number): TemplateResult {
    const selected = index === this.active;
    return html`<li
      id="command-bar-option-${String(index)}"
      class="command-bar__option${selected ? ' command-bar__option--on' : ''}"
      role="option"
      aria-selected=${String(selected)}
      @mousedown=${(event: MouseEvent) => {
        // `mousedown` and not `click`: the input is focused, and a click would blur it
        // first. Prevented, so the bar is still the thing holding focus when it closes and
        // hands it back.
        event.preventDefault();
        this.choose(entry.id);
      }}
    >
      <span class="command-bar__label">${entry.label}</span>
      ${
        entry.binding === undefined
          ? nothing
          : html`<kbd class="command-bar__key">${entry.binding}</kbd>`
      }
    </li>`;
  }

  protected override render(): unknown {
    if (!this.open) return nothing;

    const visible = this.visible;
    const say = translate.bind(null, this.locale);

    return html`<div
      class="command-bar__panel"
      role="dialog"
      aria-modal="true"
      aria-label=${say('command.bar.placeholder')}
      @keydown=${(event: KeyboardEvent) => {
        this.onKeyDown(event);
      }}
    >
      <input
        class="command-bar__input"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-expanded="true"
        aria-controls="command-bar-list"
        aria-activedescendant=${
          visible.length === 0 ? nothing : `command-bar-option-${String(this.active)}`
        }
        placeholder=${say('command.bar.placeholder')}
        .value=${this.query}
        @input=${(event: Event) => {
          this.onInput(event);
        }}
      />
      ${
        visible.length === 0
          ? html`<p class="command-bar__empty">${say('command.bar.empty')}</p>`
          : html`<ul class="command-bar__list" id="command-bar-list" role="listbox">
              ${repeat(
                visible,
                (entry) => entry.id,
                (entry, index) => this.option(entry, index),
              )}
            </ul>`
      }
    </div>`;
  }
}

customElements.define(COMMAND_BAR_TAG, CommandBar);

declare global {
  interface HTMLElementTagNameMap {
    [COMMAND_BAR_TAG]: CommandBar;
  }
}
