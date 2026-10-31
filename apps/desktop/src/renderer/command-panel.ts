import { type TemplateResult, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import { ansiPresentation } from './ansi.js';
import { type Completion, accept } from './command-completion.js';
import { type OutputLink, linksIn } from './command-links.js';
import {
  type FindMatch,
  type OutputLine,
  type Piece,
  findMatches,
  lineText,
  piecesOf,
} from './command-output.js';
import { HistoryCursor, searchHistory } from './command-history.js';
import type { CommandsOrder } from '../../shared/command-runs.js';
import { type RunBlock, blocksOf, isFolded, shortCommand, startTime } from './command-blocks.js';
import {
  type CommandRun,
  type CommandSession,
  type CommandSessions,
  isBusy,
} from './command-sessions.js';
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
  /** What can come at the caret, from the CLI's own tree (`command-completion.ts`). */
  readonly complete: (line: string, caret: number) => Promise<Completion>;
  /** The open workspace folder, absolute, for telling which printed paths are inside it. */
  readonly folder: () => string | null;
  /** Whether this platform compares paths without case. */
  readonly caseless: boolean;
  /** The lines run before in this folder, oldest first. */
  readonly history: () => readonly string[];
  readonly remember: (line: string) => void;
}

const NO_PORTS: CommandPanelPorts = {
  run: () => Promise.reject(new Error('no bridge')),
  cancel: () => undefined,
  open: () => undefined,
  complete: (_line, caret) => Promise.resolve({ from: caret, to: caret, items: [] }),
  folder: () => null,
  caseless: false,
  history: () => [],
  remember: () => undefined,
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
    order: { attribute: false },
    foldOlderRuns: { attribute: false },
  };

  declare sessions: CommandSessions | undefined;
  declare ports: CommandPanelPorts;
  /** The `commandsOrder` setting (TYTO-496): the newest run last, under the others, or first. */
  declare order: CommandsOrder;
  /** The `commandsFoldOlderRuns` setting (TYTO-496): every run but the newest folded. */
  declare foldOlderRuns: boolean;
  /** The runs a person opened while folding is on, by session. */
  private readonly opened = new Map<string, Set<number>>();

  private unsubscribe: (() => void) | undefined;
  private subscribed: CommandSessions | undefined;
  private cursor: HistoryCursor | undefined;
  private search: HistorySearch | undefined;
  private findOpen = false;
  private findQuery = '';
  private findCurrent = 0;
  /** Whether the output was scrolled to its end before the last update: then it follows. */
  private following = true;
  /** The suggestions under the prompt, while there are any (TYTO-496). */
  private completion: Completion | undefined;
  /** The one an arrow chose, or -1: then Enter runs the line and Tab takes the first. */
  private chosen = -1;
  /** Counts the questions asked, so an answer to an older line is dropped. */
  private asked = 0;

  constructor() {
    super();
    this.sessions = undefined;
    this.ports = NO_PORTS;
    this.order = 'newestLast';
    this.foldOlderRuns = false;
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
        // Following the newest run: at the end of the output, or at its top when it comes first.
        this.following =
          this.order === 'newestFirst'
            ? output.scrollTop <= 4
            : output.scrollTop + output.clientHeight >= output.scrollHeight - 4;
      }
      this.requestUpdate();
    });
  }

  protected override updated(): void {
    const output = this.output();
    if (output === null || !this.following) return;
    output.scrollTop = this.order === 'newestFirst' ? 0 : output.scrollHeight;
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
      sessions.refused(
        session.id,
        line.trim(),
        this.say('commandPanel.unclosedQuote').replaceAll('{column}', String(split.at + 1)),
      );
      return;
    }
    if (split.words.length === 0) return;

    this.ports.remember(line.trim());
    this.cursor = undefined;
    this.closeSuggestions();
    const input = this.input();
    if (input !== null) input.value = '';
    this.following = true;
    try {
      const runId = await this.ports.run(split.words);
      sessions.started(session.id, line.trim(), split.words, runId);
    } catch (error) {
      sessions.refused(
        session.id,
        line.trim(),
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

  /* ------------------------------------------------------------------- the keys -- */

  private onInputKey(event: KeyboardEvent): void {
    const input = event.currentTarget as HTMLInputElement;
    const mod = event.ctrlKey || event.metaKey;

    if (this.search !== undefined) {
      this.onSearchKey(event, input);
      return;
    }
    if (this.onCompletionKey(event, input)) return;
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
   * The suggestion list's keys (TYTO-496), as an editor's: Tab takes the chosen suggestion or the
   * first, and asks when none is shown, taking it at once when it is the only one; ↑ and ↓ choose
   * while the list is open; Enter takes a suggestion an arrow chose and otherwise runs the line;
   * Escape closes the list. Answers whether it took the key.
   */
  private onCompletionKey(event: KeyboardEvent, input: HTMLInputElement): boolean {
    const items = this.completion?.items ?? [];
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (items.length > 0) this.take(input, Math.max(this.chosen, 0));
      else void this.suggest(input, true);
      return true;
    }
    if (items.length === 0) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const by = event.key === 'ArrowDown' ? 1 : -1;
      this.chosen =
        this.chosen < 0 && by < 0
          ? items.length - 1
          : (this.chosen + by + items.length) % items.length;
      this.requestUpdate();
      return true;
    }
    if (event.key === 'Enter' && this.chosen >= 0) {
      event.preventDefault();
      this.take(input, this.chosen);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSuggestions();
      return true;
    }
    return false;
  }

  /** Asks what can come at the caret; with `takeOnly`, a single answer is taken at once. */
  private async suggest(input: HTMLInputElement, takeOnly = false): Promise<void> {
    const asked = (this.asked += 1);
    const line = input.value;
    const completion = await this.ports.complete(line, input.selectionStart ?? line.length);
    if (asked !== this.asked || input.value !== line) return;
    if (takeOnly && completion.items.length === 1) {
      this.completion = completion;
      this.take(input, 0);
      return;
    }
    this.completion = completion.items.length > 0 ? completion : undefined;
    this.chosen = -1;
    this.requestUpdate();
  }

  /** Puts a suggestion on the line, and asks again for what comes after it. */
  private take(input: HTMLInputElement, index: number): void {
    const completion = this.completion;
    const item = completion?.items[index];
    if (completion === undefined || item === undefined) return;
    const next = accept(input.value, completion, item);
    input.value = next.line;
    input.setSelectionRange(next.caret, next.caret);
    this.closeSuggestions();
    void this.suggest(input);
  }

  private closeSuggestions(): void {
    this.asked += 1;
    this.completion = undefined;
    this.chosen = -1;
    this.requestUpdate();
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
    if (this.search === undefined) {
      // As you type: what can come next, or nothing on an empty line (TYTO-496).
      if (input.value.trim() === '') this.closeSuggestions();
      else void this.suggest(input);
      return;
    }
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

  /**
   * The sessions as small tabs at the right of the header, only once there is more than one
   * (ADR 0163, TYTO-496): with one session there is nothing to choose, and the strip stays clean.
   */
  private sessionTabs(): TemplateResult | typeof nothing {
    const sessions = this.sessions;
    if (sessions === undefined || sessions.sessions.length < 2) return nothing;
    const active = sessions.active;
    return html`<div
      class="command-panel__sessions"
      role="tablist"
      aria-label=${this.say('commandPanel.sessions')}
    >
      ${repeat(
        sessions.sessions,
        (item) => item.id,
        (item, index) => this.sessionTab(item, index, item.id === active.id),
      )}
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

    // Few and quiet: Stop only while something runs, and no Copy — a selection copies.
    const actions = html`${this.sessionTabs()}
    ${
      busy
        ? this.action('stop', 'commandPanel.stop', () => {
            this.stop();
          })
        : nothing
    }
    ${this.action('search', 'commandPanel.find', () => {
      this.openFind();
    })}
    ${this.action('clear', 'commandPanel.clear', () => {
      if (session !== undefined) sessions?.clear(session.id);
    })}
    ${this.action('plus', 'commandPanel.session.new', () => {
      sessions?.create();
      this.focusInput();
    })}`;

    const fresh = session === undefined || session.runs.length === 0;

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
        ${this.findBar(matches.length)}
        <div
          class="command-panel__output"
          id="command-panel-output"
          role="log"
          aria-label=${this.say('commandPanel.output')}
          @click=${(event: MouseEvent) => {
            this.focusFromOutput(event);
          }}
        >
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
          ${this.order === 'newestFirst' ? this.prompt(fresh) : nothing}
          ${session === undefined ? nothing : this.blocks(session, matches)}
          ${this.order === 'newestFirst' ? nothing : this.prompt(fresh)}
        </div>
      </div>`;
  }

  /** The suggestions under the prompt, the chosen one marked; a click takes one. */
  private suggestions(): TemplateResult | typeof nothing {
    const items = this.completion?.items ?? [];
    if (items.length === 0) return nothing;
    return html`<ul
      class="command-panel__suggestions"
      id="command-panel-suggestions"
      role="listbox"
      aria-label=${this.say('commandPanel.suggestions')}
    >
      ${items.map(
        (item, index) =>
          html`<li
            class="command-panel__suggestion"
            id=${`command-suggestion-${String(index)}`}
            role="option"
            aria-selected=${index === this.chosen ? 'true' : 'false'}
            @mousedown=${(event: MouseEvent) => {
              // Before the input loses focus, so the caret stays on the prompt.
              event.preventDefault();
              const input = this.input();
              if (input !== null) this.take(input, index);
            }}
          >
            <span class="command-panel__suggestion-label">${item.label}</span>${
              item.detail === undefined || item.detail === ''
                ? nothing
                : html`<span class="command-panel__suggestion-detail">${item.detail}</span>`
            }
          </li>`,
      )}
    </ul>`;
  }

  /**
   * The runs as blocks (TYTO-496): each under a header that says the command, when it started
   * and how it ended, in the order `commandsOrder` asks for; older ones folded to their header
   * when `commandsFoldOlderRuns` is on, unless opened or holding a find match.
   */
  private blocks(session: CommandSession, matches: readonly FindMatch[]): TemplateResult {
    const matched = new Set(matches.map((match) => match.line));
    const opened = this.opened.get(session.id) ?? new Set<number>();
    const newest = session.runs.at(-1)?.number;
    return html`${repeat(
      blocksOf(session, this.order),
      (block) => block.run.number,
      (block) => {
        const folded = isFolded(block, newest, this.foldOlderRuns, opened, matched);
        return html`<section
          class="command-run"
          data-run=${block.run.number}
          ?data-folded=${folded}
        >
          ${this.header(session, block, folded)}
          ${folded ? nothing : block.lines.map(({ line, index }) => this.line(session, line, index, matches))}
        </section>`;
      },
    )}`;
  }

  /** The words a run's state is said in: on its header's badge, for a screen reader. */
  private runStatus(run: CommandRun): string {
    switch (run.state) {
      case 'running':
        return this.say('commandPanel.state.running');
      case 'waiting':
        return this.say('commandPanel.state.waiting').replaceAll('{question}', '');
      case 'cancelled':
        return this.say('commandPanel.state.cancelled');
      case 'refused':
        return this.say('commandPanel.state.refused');
      case 'finished':
        return this.say('commandPanel.state.finished').replaceAll('{code}', String(run.code ?? 0));
    }
  }

  private header(session: CommandSession, block: RunBlock, folded: boolean): TemplateResult {
    const run = block.run;
    const tone = run.state === 'finished' ? (run.code === 0 ? 'ok' : 'failed') : run.state;
    const badge =
      run.state === 'finished'
        ? `${run.code === 0 ? '✓' : '✗'} ${String(run.code ?? 0)}`
        : run.state === 'cancelled'
          ? '–'
          : run.state === 'refused'
            ? '✗'
            : run.state === 'waiting'
              ? '?'
              : '•';
    const status = this.runStatus(run);
    const body = html`<span class="command-run__command" title=${run.line}
        >${shortCommand(run.line)}</span
      >
      <span class="command-run__time">${startTime(run, this.locale)}</span>
      <span class="command-run__badge" data-state=${tone} title=${status} aria-label=${status}
        >${badge}</span
      >`;
    // A header is a button only while folding is on: there is something for it to do.
    if (!this.foldOlderRuns || run.number === session.runs.at(-1)?.number) {
      return html`<div class="command-run__header">${body}</div>`;
    }
    return html`<button
      type="button"
      class="command-run__header"
      aria-expanded=${folded ? 'false' : 'true'}
      @click=${() => {
        const opened = this.opened.get(session.id) ?? new Set<number>();
        if (opened.has(run.number)) opened.delete(run.number);
        else opened.add(run.number);
        this.opened.set(session.id, opened);
        this.requestUpdate();
      }}
    >
      ${body}
    </button>`;
  }

  /**
   * The prompt line: the label, the input, and Ctrl+R's match beside it. The suggestions come
   * right after it, so they sit under the prompt in either `commandsOrder`.
   */
  private prompt(fresh: boolean): TemplateResult {
    const search = this.search;
    const searchMatch =
      search?.index === undefined ? undefined : this.ports.history()[search.index];
    return html`<div class="command-panel__prompt-line">
        <label class="command-panel__prompt" for="command-panel-input"
          >${search === undefined ? 'tyto ›' : `${this.say('commandPanel.history.search')} ›`}</label
        >
        <input
          id="command-panel-input"
          class="command-panel__input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-label=${this.say('commandPanel.input')}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="command-panel-suggestions"
          aria-expanded=${this.completion === undefined ? 'false' : 'true'}
          aria-activedescendant=${this.chosen < 0 ? nothing : `command-suggestion-${String(this.chosen)}`}
          placeholder=${search === undefined && fresh ? this.say('commandPanel.input') : ''}
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
                  search.query === '' ? '' : (searchMatch ?? this.say('commandPanel.history.none'))
                }</span
              >`
        }
      </div>
      ${this.suggestions()}`;
  }

  /**
   * A click in the output puts the caret on the prompt, as a terminal does — unless it ended a
   * selection, which is someone copying, or landed on a link.
   */
  private focusFromOutput(event: MouseEvent): void {
    if ((window.getSelection()?.toString() ?? '') !== '') return;
    if (event.target instanceof Element && event.target.closest('a, input') !== null) return;
    this.input()?.focus();
  }
}

customElements.define(COMMAND_PANEL_TAG, CommandPanel);

declare global {
  interface HTMLElementTagNameMap {
    [COMMAND_PANEL_TAG]: CommandPanel;
  }
}
