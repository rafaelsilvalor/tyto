import { LitElement, type TemplateResult, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import { type HideableDock } from '../../shared/layout.js';
import { toggleDockCommandId } from './commands.js';
import { type IconName, icon } from './icons.js';

/**
 * The status bar at the foot of the window (TYTO-248, ADR 0076).
 *
 * One line, never two: what it says is short, what is long (the template's name) truncates,
 * and every button in it runs a command that already exists by id — the bar is a door to the
 * registry, like the menu and the command bar, and never a second way of doing a thing.
 *
 * It holds no state. `main.ts` builds a {@link StatusBarState} from the workspace, the layout
 * and the editor and hands it down; a click reports the command id back.
 */

export const STATUS_BAR_TAG = 'tyto-status-bar';

/** What the tab in front holds, from `DocumentState.kind`. */
export type TabKind = 'brief' | 'settings' | 'keybindings';

export interface StatusBarState {
  readonly locale: Locale;
  /** `null` while vim is off, which is when the bar shows no mode at all. */
  readonly vim: { readonly mode: string; readonly pending: string } | null;
  readonly cursor: { readonly line: number; readonly column: number; readonly selected: number };
  readonly kind: TabKind;
  /** What the brief's frontmatter names, if anything. Only a brief has one. */
  readonly template: string | undefined;
  readonly problems: number;
  readonly errors: number;
  /** Which areas are on screen, and which of the two toggled panels are open. */
  readonly shown: Readonly<Record<HideableDock | 'problems' | 'queue', boolean>>;
}

/** The ids the buttons run, in `main.ts`'s registry. Exported so a test names the same ones. */
export interface StatusBarCommands {
  readonly commandBar: string;
  readonly problems: string;
  readonly queue: string;
  readonly plugins: string;
  readonly export: string;
  readonly settings: string;
}

const KIND_LABELS: Readonly<Record<TabKind, CatalogueKey>> = {
  brief: 'panel.editor',
  settings: 'status.kind.settings',
  keybindings: 'status.kind.keybindings',
};

/** `Ln 4, Col 17 (7 selected)`, in the window's language. */
export function positionText(state: StatusBarState): string {
  const { line, column, selected } = state.cursor;
  const position = translate(state.locale, 'status.position')
    .replace('{line}', String(line))
    .replace('{column}', String(column));
  if (selected === 0) return position;
  return `${position} (${translate(state.locale, 'status.selected').replace('{count}', String(selected))})`;
}

/**
 * Vim's mode in vim's own word, `VISUAL LINE`, untranslated: it is the editor's vocabulary,
 * the way `:w` is, and the highlight around it does what the library's `--` did.
 */
export const vimModeText = (mode: string): string => mode.toUpperCase();

export class StatusBar extends LitElement {
  static override properties = {
    state: { attribute: false },
    commands: { attribute: false },
    run: { attribute: false },
  };

  declare state: StatusBarState;
  declare commands: StatusBarCommands;
  declare run: (id: string) => void;

  constructor() {
    super();
    this.state = {
      locale: DEFAULT_LOCALE,
      vim: null,
      cursor: { line: 1, column: 1, selected: 0 },
      kind: 'brief',
      template: undefined,
      problems: 0,
      errors: 0,
      shown: { left: false, right: false, bottom: false, problems: false, queue: false },
    };
    this.commands = {
      commandBar: '',
      problems: '',
      queue: '',
      plugins: '',
      export: '',
      settings: '',
    };
    this.run = () => undefined;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private button(
    name: IconName,
    command: string,
    label: string,
    on: boolean | undefined,
    content: unknown = nothing,
  ): TemplateResult {
    // `aria-pressed` only on a toggle: a button that opens something is not on or off.
    return html`<button
      type="button"
      class="status-bar__button ${on === true ? 'status-bar__button--on' : ''}"
      data-command=${command}
      title=${label}
      aria-label=${label}
      aria-pressed=${on === undefined ? nothing : String(on)}
      @click=${() => {
        this.run(command);
      }}
    >
      ${icon(name, on === true)}${content}
    </button>`;
  }

  protected override render(): unknown {
    const state = this.state;
    const say = (key: CatalogueKey): string => translate(state.locale, key);
    const toggle = (panel: CatalogueKey): string =>
      `${say('command.layout.togglePanel')}: ${say(panel)}`;
    const dock = (area: HideableDock, name: IconName, key: CatalogueKey): TemplateResult =>
      this.button(name, toggleDockCommandId(area), say(key), state.shown[area]);

    return html`<div class="status-bar__side">
        ${dock('left', 'left', 'command.layout.toggleDock.left')}
        ${this.button('commandBar', this.commands.commandBar, say('status.commandBar'), undefined)}
        ${
          state.vim === null
            ? nothing
            : html`<span class="status-bar__vim">${vimModeText(state.vim.mode)}</span>
                <span class="status-bar__text status-bar__pending">${state.vim.pending}</span>`
        }
      </div>
      <div class="status-bar__side status-bar__side--end">
        <span class="status-bar__text status-bar__position">${positionText(state)}</span>
        <span class="status-bar__text status-bar__kind">${say(KIND_LABELS[state.kind])}</span>
        ${
          state.template === undefined
            ? nothing
            : html`<span
                class="status-bar__text status-bar__template"
                title=${say('template.label')}
                >${state.template}</span
              >`
        }
        <!-- The problems button holds its count, and is where TYTO-143's "new" mark will go. -->
        ${this.button(
          'problems',
          this.commands.problems,
          toggle('panel.problems'),
          state.shown.problems,
          html`<span class="status-bar__count ${state.errors > 0 ? 'status-bar__count--bad' : ''}"
            >${state.problems}</span
          >`,
        )}
        ${this.button('queue', this.commands.queue, toggle('panel.queue'), state.shown.queue)}
        ${this.button('plugins', this.commands.plugins, say('command.plugins.show'), undefined)}
        ${this.button('export', this.commands.export, say('command.file.export'), undefined)}
        ${this.button('settings', this.commands.settings, say('command.settings.open'), undefined)}
        ${dock('bottom', 'bottom', 'command.layout.toggleDock.bottom')}
        ${dock('right', 'right', 'command.layout.toggleDock.right')}
      </div>`;
  }
}

customElements.define(STATUS_BAR_TAG, StatusBar);

declare global {
  interface HTMLElementTagNameMap {
    [STATUS_BAR_TAG]: StatusBar;
  }
}
