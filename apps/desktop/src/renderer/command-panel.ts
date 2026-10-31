import { type TemplateResult, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import { ansiPresentation } from './ansi.js';
import { type OutputLink, linksIn } from './command-links.js';
import {
  type FindMatch,
  type OutputLine,
  type Piece,
  findMatches,
  lineText,
  piecesOf,
  scrollbackText,
} from './command-output.js';
import { HistoryCursor, searchHistory } from './command-history.js';
import { type CommandSession, type CommandSessions, isBusy } from './command-sessions.js';
import { splitCommandLine } from './command-words.js';
import { icon } from './icons.js';
import { DockedPanel } from './panels.js';

/**
 * The command panel (TYTO-496, ADR 0159): `tyto` commands typed into the window and run in
 * main, beside Problems in the bottom area.
 *
 * Tabs of sessions, each with one run at a time, its scrollback, and how the run ended; an
 * input line with the history on ↑/↓ and Ctrl+R; the output in colour, with the places a
 * command printed opening the file, Ctrl+F to find in it, Copy and Clear.
 *
 * **It runs nothing and holds no bridge.** The sessions live in a {@link CommandSessions}
 * `main.ts` keeps for the window's life, because this element is removed whenever the panel
 * closes and a `watch` keeps printing; what a run, a Stop or a click does is a port.
 */

export const COMMAND_PANEL_TAG = 'tyto-command-panel';

export interface CommandPanelPorts {
  /** Starts the words as a run and answers its id; throws when `cli:run` refused them. */
  readonly run: (words: readonly string[]) => Promise<string>;
  readonly cancel: (runId: string) => void;
  /** Opens what a link in a session's output names. */
  readonly open: (session: CommandSession, link: OutputLink) => void;
  /** The open workspace folder, absolute, for telling which printed paths are inside it. */
  readonly folder: () => string | null;
  /** Whether this platform compares paths without case. */
  readonly caseless: boolean;
  /** The lines run before in this folder, oldest first. */
  readonly history: () => readonly string[];
  readonly remember: (line: string) => void;
  readonly copy: (text: string) => void;
}

const NO_PORTS: CommandPanelPorts = {
  run: () => Promise.reject(new Error('no bridge')),
  cancel: () => undefined,
  open: () => undefined,
  folder: () => null,
  caseless: false,
  history: () => [],
  remember: () => undefined,
  copy: () => undefined,
};

/** Ctrl+R's state: what is typed in the search, and where the match is in the history. */
interface HistorySearch {
  readonly query: string;
  readonly index: number | undefined;
}

export class CommandPanel extends DockedPanel {
  static override properties = {
    ...DockedPanel.properties,
    sessions: { attribute: false },
    ports: { attribute: false },
  };

  declare sessions: CommandSessions | undefined;
  declare ports: CommandPanelPorts;

  private unsubscribe: (() => void) | undefined;
  private subscribed: CommandSessions | undefined;
  private cursor: HistoryCursor | undefined;
  private search: HistorySearch | undefined;
  private findOpen = false;
  private findQuery = '';
  private findCurrent = 0;
  /** Whether the output was scrolled to its end before the last update: then it follows. */
  private following = true;

  constructor() {
    super();
    this.sessions = undefined;
    this.ports = NO_PORTS;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.subscribed = undefined;
  }

  protected override willUpdate(): void {
    if (this.sessions === this.subscribed) return;
    this.unsubscribe?.();
    this.subscribed = this.sessions;
    this.unsubscribe = this.sessions?.subscribe(() => {
      const output = this.output();
      if (output !== null) {
        this.following = output.scrollTop + output.clientHeight >= output.scrollHeight - 4;
      }
      this.requestUpdate();
    });
  }

  protected override updated(): void {
    const output = this.output();
    if (output !== null && this.following) output.scrollTop = output.scrollHeight;
  }

  /** Puts the caret on the input line: Ctrl+` and a quick action land here. */
  focusInput(): void {
    void this.updateComplete.then(() => {
      this.input()?.focus();
    });
  }

  /** Writes `line` on the input line, caret at its end, without running it. */
  fill(line: string): void {
    void this.updateComplete.then(() => {
      const input = this.input();
      if (input === null) return;
      input.value = line;
      input.focus();
      input.setSelectionRange(line.length, line.length);
    });
  }

  private input(): HTMLInputElement | null {
    return this.querySelector<HTMLInputElement>('.command-panel__input');
  }

  private output(): HTMLElement | null {
    return this.querySelector<HTMLElement>('.command-panel__output');
  }

  private active(): CommandSession | undefined {
    return this.sessions?.active;
  }

  /* -------------------------------------------------------------------- running -- */

  /** Enter on the input line: the line split into words, refused or run in this tab. */
  async submit(line: string): Promise<void> {
    const sessions = this.sessions;
    const session = this.active();
    if (sessions === undefined || session === undefined) return;
    if (line.trim() === '') return;
    if (isBusy(session)) {
      sessions.note(session.id, this.say('commandPanel.busy'));
      return;
    }
    const split = splitCommandLine(line);
    if (!split.ok) {
      sessions.note(
        session.id,
        this.say('commandPanel.unclosedQuote').replaceAll('{column}', String(split.at + 1)),
      );
      return;
    }
    if (split.words.length === 0) return;

    this.ports.remember(line.trim());
    this.cursor = undefined;
    const input = this.input();
    if (input !== null) input.value = '';
    sessions.note(session.id, `$ tyto ${line.trim().replace(/^tyto\s+/u, '')}`);
    this.following = true;
    try {
      const runId = await this.ports.run(split.words);
      sessions.started(session.id, line.trim(), split.words, runId);
    } catch (error) {
      sessions.note(
        session.id,
        this.say('commandPanel.refused').replaceAll(
          '{reason}',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  private stop(): void {
    const session = this.active();
    if (session?.runId !== undefined && isBusy(session)) this.ports.cancel(session.runId);
  }

  private closeSession(id: string): void {
    const runId = this.sessions?.close(id);
    if (runId !== undefined) this.ports.cancel(runId);
  }

  private copyOutput(): void {
    const session = this.active();
    if (session === undefined) return;
    const selected = window.getSelection()?.toString() ?? '';
    const output = this.output();
    const inside =
      selected !== '' &&
      output !== null &&
      window.getSelection()?.anchorNode !== null &&
      output.contains(window.getSelection()?.anchorNode ?? null);
    this.ports.copy(inside ? selected : scrollbackText(session.scrollback));
  }

  /* ------------------------------------------------------------------- the keys -- */

  private onInputKey(event: KeyboardEvent): void {
    const input = event.currentTarget as HTMLInputElement;
    const mod = event.ctrlKey || event.metaKey;

    if (this.search !== undefined) {
      this.onSearchKey(event, input);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.submit(input.value);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.cursor ??= new HistoryCursor(this.ports.history());
      const next = event.key === 'ArrowUp' ? this.cursor.older(input.value) : this.cursor.newer();
      if (next !== undefined) {
        input.value = next;
        input.setSelectionRange(next.length, next.length);
      }
    } else if (mod && !event.shiftKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      this.search = { query: '', index: undefined };
      this.requestUpdate();
    } else if (mod && !event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      const session = this.active();
      if (session !== undefined) this.sessions?.clear(session.id);
    } else if (
      mod &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'c' &&
      input.selectionStart === input.selectionEnd
    ) {
      // A terminal's Ctrl+C: stop what is running. With text selected it copies, as anywhere.
      const session = this.active();
      if (session !== undefined && isBusy(session)) {
        event.preventDefault();
        this.stop();
      }
    } else if (event.key !== 'Shift' && !mod) {
      // Typing leaves the walk through the history where it is: ↑ starts again from the end.
      this.cursor = undefined;
    }
  }

  /**
   * Ctrl+R: the input line searches the history, newest first. Ctrl+R again steps to an older
   * match, Enter runs the match, Escape gives the line back as it was, an arrow keeps the match
   * on the line to edit.
   */
  private onSearchKey(event: KeyboardEvent, input: HTMLInputElement): void {
    const search = this.search;
    if (search === undefined) return;
    const history = this.ports.history();
    const mod = event.ctrlKey || event.metaKey;
    const matched = search.index === undefined ? undefined : history[search.index];

    if (mod && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      const older = searchHistory(history, search.query, search.index ?? history.length);
      this.search = { query: search.query, index: older?.index ?? search.index };
      this.requestUpdate();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.search = undefined;
      input.value = '';
      this.requestUpdate();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.search = undefined;
      this.requestUpdate();
      if (matched !== undefined) void this.submit(matched);
      return;
    }
    if (event.key.startsWith('Arrow') || event.key === 'Tab') {
      event.preventDefault();
      this.search = undefined;
      input.value = matched ?? '';
      this.requestUpdate();
    }
  }

  private onSearchInput(input: HTMLInputElement): void {
    if (this.search === undefined) return;
    const history = this.ports.history();
    const query = input.value;
    this.search = { query, index: query === '' ? undefined : searchHistory(history, query)?.index };
    this.requestUpdate();
  }

  private openFind(): void {
    this.findOpen = true;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      const find = this.querySelector<HTMLInputElement>('.command-panel__find-input');
      find?.focus();
      find?.select();
    });
  }

  private closeFind(): void {
    this.findOpen = false;
    this.findQuery = '';
    this.requestUpdate();
    this.input()?.focus();
  }

  private stepFind(by: number, total: number): void {
    if (total === 0) return;
    this.findCurrent = (this.findCurrent + by + total) % total;
    this.following = false;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.querySelector('.command-panel__match--current')?.scrollIntoView({ block: 'nearest' });
    });
  }

  private onFindKey(event: KeyboardEvent, total: number): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.stepFind(event.shiftKey ? -1 : 1, total);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closeFind();
    }
  }

  /** ← and → move between the tabs, Home and End to the ends, as a tab list does. */
  private onTabKey(event: KeyboardEvent, index: number): void {
    const sessions = this.sessions?.sessions ?? [];
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : undefined;
    let next: number | undefined;
    if (step !== undefined) next = (index + step + sessions.length) % sessions.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = sessions.length - 1;
    if (event.key === 'Delete') {
      const id = sessions[index]?.id;
      if (id !== undefined) this.closeSession(id);
      event.preventDefault();
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    const target = sessions[next];
    if (target === undefined) return;
    this.sessions?.select(target.id);
    void this.updateComplete.then(() => {
      this.querySelector<HTMLElement>(`[data-session="${target.id}"]`)?.focus();
    });
  }

  /* ------------------------------------------------------------------ rendering -- */

  /** A tab's status in words: what a screen reader says and what hovering shows. */
  private statusText(session: CommandSession): string {
    switch (session.state) {
      case 'idle':
        return this.say('commandPanel.state.idle');
      case 'running':
        return this.say('commandPanel.state.running');
      case 'waiting':
        return this.say('commandPanel.state.waiting').replaceAll(
          '{question}',
          session.question ?? '',
        );
      case 'cancelled':
        return this.say('commandPanel.state.cancelled');
      case 'finished':
        return this.say('commandPanel.state.finished').replaceAll(
          '{code}',
          String(session.code ?? 0),
        );
    }
  }

  private statusMark(session: CommandSession): TemplateResult {
    const glyph =
      session.state === 'finished'
        ? String(session.code ?? 0)
        : session.state === 'cancelled'
          ? '–'
          : session.state === 'waiting'
            ? '?'
            : session.state === 'running'
              ? '•'
              : '';
    const tone =
      session.state === 'finished' ? (session.code === 0 ? 'ok' : 'failed') : session.state;
    return html`<span class="command-session__status" data-state=${tone} aria-hidden="true"
      >${glyph}</span
    >`;
  }

  private sessionTab(session: CommandSession, index: number, active: boolean): TemplateResult {
    const name =
      session.line ??
      this.say('commandPanel.session').replaceAll('{number}', String(session.number));
    const status = this.statusText(session);
    return html`<div class="command-session" ?data-active=${active}>
      <button
        type="button"
        role="tab"
        class="command-session__tab"
        data-session=${session.id}
        aria-selected=${active ? 'true' : 'false'}
        aria-controls="command-panel-output"
        tabindex=${active ? '0' : '-1'}
        title=${`${name} — ${status}`}
        aria-label=${`${name}, ${status}`}
        @click=${() => this.sessions?.select(session.id)}
        @keydown=${(event: KeyboardEvent) => {
          this.onTabKey(event, index);
        }}
      >
        ${this.statusMark(session)}<span class="command-session__name">${name}</span>
      </button>
      <button
        type="button"
        class="command-session__close"
        tabindex="-1"
        title=${this.say('commandPanel.session.close')}
        aria-label=${this.say('commandPanel.session.close')}
        @click=${() => {
          this.closeSession(session.id);
        }}
      >
        ×
      </button>
    </div>`;
  }

  private action(
    name: Parameters<typeof icon>[0],
    key: CatalogueKey,
    run: () => void,
    disabled = false,
  ): TemplateResult {
    const label = this.say(key);
    return html`<button
      type="button"
      class="tool__action"
      data-action=${key}
      title=${label}
      aria-label=${label}
      ?disabled=${disabled}
      @click=${run}
    >
      ${icon(name)}
    </button>`;
  }

  private piece(session: CommandSession, piece: Piece, current: number): TemplateResult {
    const { classes, css } = ansiPresentation(piece.style);
    const match =
      piece.match === undefined
        ? ''
        : piece.match === current
          ? ' command-panel__match command-panel__match--current'
          : ' command-panel__match';
    const style = css === '' ? nothing : css;
    const link = piece.link;
    if (link === undefined) {
      return html`<span class=${classes + match} style=${style}>${piece.text}</span>`;
    }
    return html`<a
      href="#"
      class=${`command-panel__link ${classes}${match}`}
      style=${style}
      title=${this.say('commandPanel.link')}
      @click=${(event: MouseEvent) => {
        event.preventDefault();
        this.ports.open(session, link);
      }}
      >${piece.text}</a
    >`;
  }

  private line(
    session: CommandSession,
    line: OutputLine,
    index: number,
    matches: readonly FindMatch[],
  ): TemplateResult {
    const own = matches
      .map((match, position) => ({ ...match, index: position }))
      .filter((match) => match.line === index);
    const links =
      line.stream === 'note'
        ? []
        : linksIn(lineText(line), {
            diagnostics: session.diagnostics,
            folder: this.ports.folder(),
            caseless: this.ports.caseless,
          });
    const pieces = piecesOf(line.runs, links, own);
    const drawn = pieces.map((piece) => this.piece(session, piece, this.findCurrent));
    // On one line, and it has to stay on one: the line is `pre-wrap`, so any whitespace around
    // the pieces in this template would be drawn as part of what the command printed.
    return html`<div class="command-panel__line" data-stream=${line.stream}>${drawn}</div>`;
  }

  private findBar(total: number): TemplateResult | typeof nothing {
    if (!this.findOpen) return nothing;
    const count =
      this.findQuery === ''
        ? ''
        : total === 0
          ? this.say('commandPanel.find.none')
          : this.say('commandPanel.find.count')
              .replaceAll('{current}', String(this.findCurrent + 1))
              .replaceAll('{total}', String(total));
    return html`<div class="command-panel__find" role="search">
      <input
        type="search"
        class="command-panel__find-input"
        aria-label=${this.say('commandPanel.find')}
        placeholder=${this.say('commandPanel.find')}
        .value=${this.findQuery}
        spellcheck="false"
        @input=${(event: InputEvent) => {
          this.findQuery = (event.currentTarget as HTMLInputElement).value;
          this.findCurrent = 0;
          this.requestUpdate();
        }}
        @keydown=${(event: KeyboardEvent) => {
          this.onFindKey(event, total);
        }}
      />
      <output class="command-panel__find-count" aria-live="polite">${count}</output>
      ${this.action('chevronDown', 'commandPanel.find.next', () => {
        this.stepFind(1, total);
      })}
      <button
        type="button"
        class="tool__action"
        title=${this.say('commandPanel.find.close')}
        aria-label=${this.say('commandPanel.find.close')}
        @click=${() => {
          this.closeFind();
        }}
      >
        ×
      </button>
    </div>`;
  }

  protected override render(): unknown {
    const sessions = this.sessions;
    const session = sessions?.active;
    const busy = session !== undefined && isBusy(session);
    const matches =
      session === undefined || !this.findOpen
        ? []
        : findMatches(session.scrollback, this.findQuery);
    if (this.findCurrent >= matches.length) this.findCurrent = 0;

    const actions = html`${this.action('plus', 'commandPanel.session.new', () => {
      sessions?.create();
      this.focusInput();
    })}
    ${this.action(
      'stop',
      'commandPanel.stop',
      () => {
        this.stop();
      },
      !busy,
    )}
    ${this.action('search', 'commandPanel.find', () => {
      this.openFind();
    })}
    ${this.action('copy', 'commandPanel.copy', () => {
      this.copyOutput();
    })}
    ${this.action('clear', 'commandPanel.clear', () => {
      if (session !== undefined) sessions?.clear(session.id);
    })}`;

    const search = this.search;
    const searchMatch =
      search?.index === undefined ? undefined : this.ports.history()[search.index];

    return html`${this.chrome(
        html`<h2 class="tool__title">${this.say('panel.commands')}</h2>`,
        actions,
      )}
      <div
        class="command-panel"
        @keydown=${(event: KeyboardEvent) => {
          // Ctrl+F from anywhere in the panel finds in the output, not in the page.
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            this.openFind();
          }
        }}
      >
        <div
          class="command-panel__sessions"
          role="tablist"
          aria-label=${this.say('commandPanel.sessions')}
        >
          ${repeat(
            sessions?.sessions ?? [],
            (item) => item.id,
            (item, index) => this.sessionTab(item, index, item.id === session?.id),
          )}
        </div>
        ${this.findBar(matches.length)}
        <div
          class="command-panel__output"
          id="command-panel-output"
          role="log"
          aria-label=${this.say('commandPanel.output')}
          tabindex="0"
        >
          ${
            session === undefined || session.scrollback.lines.length > 0
              ? nothing
              : html`<p class="command-panel__empty">${this.say('commandPanel.empty')}</p>`
          }
          ${
            session === undefined || session.scrollback.dropped === 0
              ? nothing
              : html`<p class="command-panel__dropped">
                  ${this.say('commandPanel.dropped').replaceAll(
                    '{count}',
                    String(session.scrollback.dropped),
                  )}
                </p>`
          }
          ${
            session === undefined
              ? nothing
              : repeat(
                  session.scrollback.lines,
                  (_line, index) => index + session.scrollback.dropped,
                  (line, index) => this.line(session, line, index, matches),
                )
          }
        </div>
        <div class="command-panel__prompt-row">
          <label class="command-panel__prompt" for="command-panel-input"
            >${search === undefined ? 'tyto' : this.say('commandPanel.history.search')}</label
          >
          <input
            id="command-panel-input"
            class="command-panel__input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label=${this.say('commandPanel.input')}
            placeholder=${search === undefined ? this.say('commandPanel.input') : ''}
            @keydown=${(event: KeyboardEvent) => {
              this.onInputKey(event);
            }}
            @input=${(event: InputEvent) => {
              this.onSearchInput(event.currentTarget as HTMLInputElement);
            }}
          />
          ${
            search === undefined
              ? nothing
              : html`<span class="command-panel__search-match" aria-live="polite"
                  >${
                    search.query === ''
                      ? ''
                      : (searchMatch ?? this.say('commandPanel.history.none'))
                  }</span
                >`
          }
        </div>
      </div>`;
  }
}

customElements.define(COMMAND_PANEL_TAG, CommandPanel);

declare global {
  interface HTMLElementTagNameMap {
    [COMMAND_PANEL_TAG]: CommandPanel;
  }
}
