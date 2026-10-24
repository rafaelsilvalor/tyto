import { LitElement, type TemplateResult, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import { type HideableDock } from '../../shared/layout.js';
import {
  type StatusBarItemId,
  STATUS_BAR_ITEM_IDS,
  itemsOnSide,
} from '../../shared/status-bar-items.js';
import { type VimModeStyle } from '../../shared/vim-mode-style.js';
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
 *
 * **Which items show is a setting** (TYTO-301, ADR 0091): `items` is `statusBarItems` as main
 * answered it, and each side draws the ids that live on it in that list's order. An item the
 * list leaves out is not drawn at all; one it names is drawn when it has something to show.
 */

export const STATUS_BAR_TAG = 'tyto-status-bar';

/** What the tab in front holds, from `DocumentState.kind`. */
export type TabKind =
  | 'brief'
  | 'settings'
  | 'keybindings'
  | 'snippets'
  | 'text'
  | 'markdown'
  | 'preview'
  | 'markdown-preview';

/**
 * The kinds the Export button is not drawn for (TYTO-247): a text file and a Markdown file's
 * preview are never exported, and a greyed button there looked like one that should work.
 */
const NOT_EXPORTED: ReadonlySet<TabKind> = new Set(['text', 'markdown', 'markdown-preview']);

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
  /**
   * Whether a problem the window raised itself arrived since the problems panel was last on
   * screen (TYTO-143). Drawn as a dot beside the count: the number says how many, the dot
   * says new.
   */
  readonly newProblems: boolean;
  /** Which areas are on screen, and which of the two toggled panels are open. */
  readonly shown: Readonly<Record<HideableDock | 'problems' | 'explorer' | 'queue', boolean>>;
  /**
   * Which areas any panel lives in (TYTO-287): an area with none gets no button, which is the
   * right one by default since the preview became a tab. Absent means every area has one.
   */
  readonly areas?: Readonly<Record<HideableDock, boolean>>;
}

/** The ids the buttons run, in `main.ts`'s registry. Exported so a test names the same ones. */
export interface StatusBarCommands {
  readonly commandBar: string;
  readonly problems: string;
  readonly explorer: string;
  readonly queue: string;
  readonly plugins: string;
  readonly export: string;
  readonly settings: string;
}

const KIND_LABELS: Readonly<Record<TabKind, CatalogueKey>> = {
  brief: 'panel.editor',
  settings: 'status.kind.settings',
  keybindings: 'status.kind.keybindings',
  snippets: 'status.kind.snippets',
  // TYTO-247: "Plain text" for a `.txt`, "Markdown" for a `.md`.
  text: 'status.kind.text',
  markdown: 'status.kind.markdown',
  preview: 'preview.heading',
  'markdown-preview': 'preview.heading',
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
 * The problems button's label, which says how many and, while the dot is lit, "new": the
 * dot is drawn and `aria-hidden`, so a screen reader hears it here or not at all.
 *
 * The count is in the label because `aria-label` replaces the button's content as its
 * accessible name, so the visible number never reaches a screen reader on its own. Until
 * TYTO-267 the problems panel's heading carried a second count in an `<output>`, and that
 * was the one a screen reader could find; with it gone, this is the window's only count.
 */
export function problemsLabel(state: StatusBarState, toggle: string): string {
  if (!state.newProblems) return `${toggle} (${state.problems})`;
  return `${toggle} (${state.problems}, ${translate(state.locale, 'status.problems.new')})`;
}

/**
 * Vim's mode in vim's own word, `VISUAL LINE`, untranslated: it is the editor's vocabulary,
 * the way `:w` is, and the badge around it does what the library's `--` did.
 */
export const vimModeText = (mode: string): string => mode.toUpperCase();

/** The four modes the badge has a colour for, one token pair each in the theme (TYTO-301). */
export const VIM_BADGE_MODES = ['normal', 'insert', 'visual', 'replace'] as const;
export type VimBadgeMode = (typeof VIM_BADGE_MODES)[number];

/**
 * Which colour the badge wears for vim's mode: its first word, so `visual line` and `visual
 * block` are visual. The library reports only these four, and a word it might add later is
 * drawn as normal rather than with no colour at all.
 */
export function vimBadgeMode(mode: string): VimBadgeMode {
  const word = mode.split(' ')[0] ?? '';
  return (VIM_BADGE_MODES as readonly string[]).includes(word) ? (word as VimBadgeMode) : 'normal';
}

/**
 * Tells the bar's element — `.shell__foot`, which holds this one and the update notice — how
 * vim's mode is drawn (TYTO-301, ADR 0091): `data-vim-style` is the `vimModeStyle` setting, and
 * `data-vim-mode` the mode's colour while vim is on and absent while it is off, so with vim off
 * every style is the plain bar. `shell.css` draws the border and the bar from the two; the
 * badge stays this element's own.
 */
export function paintVimStyle(
  foot: HTMLElement,
  style: VimModeStyle,
  vim: StatusBarState['vim'],
): void {
  foot.dataset['vimStyle'] = style;
  if (vim === null) delete foot.dataset['vimMode'];
  else foot.dataset['vimMode'] = vimBadgeMode(vim.mode);
}

export class StatusBar extends LitElement {
  static override properties = {
    state: { attribute: false },
    commands: { attribute: false },
    run: { attribute: false },
    offered: { attribute: false },
    items: { attribute: false },
  };

  declare state: StatusBarState;
  declare commands: StatusBarCommands;
  declare run: (id: string) => void;
  /**
   * Whether a button's command is offered with the tab in front (TYTO-283): Export is greyed
   * with `settings.json` in front, as the File menu's item is. The window's predicate, handed in.
   */
  declare offered: (id: string) => boolean;
  /** The `statusBarItems` setting: which items show, in order inside their side. */
  declare items: readonly StatusBarItemId[];

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
      newProblems: false,
      shown: {
        left: false,
        right: false,
        bottom: false,
        problems: false,
        explorer: false,
        queue: false,
      },
    };
    this.commands = {
      commandBar: '',
      problems: '',
      explorer: '',
      queue: '',
      plugins: '',
      export: '',
      settings: '',
    };
    this.run = () => undefined;
    this.offered = () => true;
    this.items = STATUS_BAR_ITEM_IDS;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private button(
    item: StatusBarItemId,
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
      data-item=${item}
      data-command=${command}
      title=${label}
      aria-label=${label}
      aria-pressed=${on === undefined ? nothing : String(on)}
      ?disabled=${!this.offered(command)}
      @click=${() => {
        this.run(command);
      }}
    >
      ${icon(name, on === true)}${content}
    </button>`;
  }

  protected override render(): unknown {
    const draw = (id: StatusBarItemId): unknown => this.item(id);
    return html`<div class="status-bar__side">${itemsOnSide(this.items, 'start').map(draw)}</div>
      <div class="status-bar__side status-bar__side--end">
        ${itemsOnSide(this.items, 'end').map(draw)}
      </div>`;
  }

  /** One item by its id, or nothing when it has nothing to show right now. */
  private item(id: StatusBarItemId): unknown {
    const state = this.state;
    const say = (key: CatalogueKey): string => translate(state.locale, key);
    const toggle = (panel: CatalogueKey): string =>
      `${say('command.layout.togglePanel')}: ${say(panel)}`;
    const dock = (area: HideableDock, name: IconName, key: CatalogueKey): unknown =>
      state.areas?.[area] === false
        ? nothing
        : this.button(id, name, toggleDockCommandId(area), say(key), state.shown[area]);

    switch (id) {
      case 'leftArea':
        return dock('left', 'left', 'command.layout.toggleDock.left');
      case 'commandBar':
        return this.button(
          id,
          'commandBar',
          this.commands.commandBar,
          say('status.commandBar'),
          undefined,
        );
      case 'vimMode':
        return state.vim === null
          ? nothing
          : html`<span
                class="status-bar__vim"
                data-item=${id}
                data-mode=${vimBadgeMode(state.vim.mode)}
                >${vimModeText(state.vim.mode)}</span
              >
              <span class="status-bar__text status-bar__pending" data-item=${id}
                >${state.vim.pending}</span
              >`;
      case 'cursorPosition':
        // A preview has no caret, so no line and column (TYTO-287).
        return state.kind === 'preview' || state.kind === 'markdown-preview'
          ? nothing
          : html`<span class="status-bar__text status-bar__position" data-item=${id}
              >${positionText(state)}</span
            >`;
      case 'tabKind':
        return html`<span class="status-bar__text status-bar__kind" data-item=${id}
          >${say(KIND_LABELS[state.kind])}</span
        >`;
      case 'template':
        return state.template === undefined
          ? nothing
          : html`<span
              class="status-bar__text status-bar__template"
              data-item=${id}
              title=${say('template.label')}
              >${state.template}</span
            >`;
      case 'problems':
        // The problems button holds its count and, beside it, TYTO-143's "new" dot.
        return this.button(
          id,
          'problems',
          this.commands.problems,
          problemsLabel(state, toggle('panel.problems')),
          state.shown.problems,
          html`<span class="status-bar__count ${state.errors > 0 ? 'status-bar__count--bad' : ''}"
              >${state.problems}</span
            >${
              state.newProblems
                ? html`<span class="status-bar__new" aria-hidden="true"></span>`
                : nothing
            }`,
        );
      case 'explorer':
        return this.button(
          id,
          'explorer',
          this.commands.explorer,
          toggle('panel.explorer'),
          state.shown.explorer,
        );
      case 'queue':
        return this.button(
          id,
          'queue',
          this.commands.queue,
          toggle('panel.queue'),
          state.shown.queue,
        );
      case 'plugins':
        return this.button(
          id,
          'plugins',
          this.commands.plugins,
          say('command.plugins.show'),
          undefined,
        );
      case 'export':
        if (NOT_EXPORTED.has(state.kind)) return nothing;
        return this.button(
          id,
          'export',
          this.commands.export,
          say('command.file.export'),
          undefined,
        );
      case 'settings':
        return this.button(
          id,
          'settings',
          this.commands.settings,
          say('command.settings.open'),
          undefined,
        );
      case 'bottomArea':
        return dock('bottom', 'bottom', 'command.layout.toggleDock.bottom');
      case 'rightArea':
        return dock('right', 'right', 'command.layout.toggleDock.right');
    }
  }
}

customElements.define(STATUS_BAR_TAG, StatusBar);

declare global {
  interface HTMLElementTagNameMap {
    [STATUS_BAR_TAG]: StatusBar;
  }
}
