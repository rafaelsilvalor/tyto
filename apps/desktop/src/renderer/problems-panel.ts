import { LitElement, type TemplateResult, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import { type Diagnostic, type SourceRange, lineColumnAt } from './panel.js';

/**
 * The problems panel, and the first piece of the window that is a component rather than a
 * painter (ADR 0024).
 *
 * The whole of what it does is the same as the hand-written `paintProblems` it replaces —
 * list what the stages said, put the cursor on the span each one names — and it is here to
 * carry the two properties that one could not:
 *
 * **It owns its own strings.** `translate` is called inside `render`, so a locale change is
 * a property change and not a second pass over the document. The `[data-i18n]` walk in
 * `shell.ts` still paints the rest of the window; nothing inside this element is in it.
 *
 * **It updates in place.** A keystroke replaces the whole `diagnostics` array, and `repeat`
 * keyed by the diagnostic's identity rewrites only the text that changed — 0.14 ms against
 * the 1.62 ms `replaceChildren` cost for the same 200 rows (ADR 0024). The rows a person is
 * looking at keep their DOM nodes, which is what a scroll position needs and what
 * `replaceChildren` could not leave standing.
 */

/** Light DOM, so `shell.css` reaches inside. See {@link ProblemsPanel.createRenderRoot}. */
export const PROBLEMS_TAG = 'tyto-problems';

export interface ProblemsState {
  readonly diagnostics: readonly Diagnostic[];
  /** The brief the diagnostics were computed against, for turning an offset into a line. */
  readonly brief: string;
  readonly locale: Locale;
  /**
   * What the document in front is, so the empty state can name it (TYTO-322): "this brief"
   * is wrong with `settings.json` in front. Absent means a brief.
   */
  readonly kind?: ProblemsKind;
  /**
   * What `tyto` commands run from the window reported (TYTO-495, ADR 0159 decision 7): a section
   * per run under the brief's rows, the newest last. Absent or empty, the panel is the brief's.
   */
  readonly commands?: readonly CommandProblems[];
}

/** One run's rows, under the command it ran (`cli:diagnostics`). */
export interface CommandProblems {
  readonly runId: string;
  readonly label: string;
  readonly diagnostics: readonly CommandProblemRow[];
}

/**
 * How many runs the panel keeps a section for: the last five, a run's later rows adding to its
 * own section. A default the command panel (TYTO-496) may revisit, kept in step with main's
 * `KEPT_RUNS`, which is how many runs a click can still open.
 */
export const SHOWN_RUNS = 5;

/** The sections after one `cli:diagnostics` push: added to its run's, or a new one last. */
export function withCommandProblems(
  sections: readonly CommandProblems[],
  pushed: CommandProblems,
): readonly CommandProblems[] {
  const found = sections.find((section) => section.runId === pushed.runId);
  if (found !== undefined) {
    return sections.map((section) =>
      section === found
        ? { ...section, diagnostics: [...section.diagnostics, ...pushed.diagnostics] }
        : section,
    );
  }
  return [...sections, pushed].slice(-SHOWN_RUNS);
}

/** The offset of a 1-based line and column in `text`, held inside it. */
export function offsetAt(text: string, line: number, column: number): number {
  let offset = 0;
  for (let at = 1; at < line; at += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return Math.min(offset + Math.max(0, column - 1), text.length);
}

/** A diagnostic placed by the command that printed it, in its own file, not the brief's. */
export interface CommandProblemRow {
  readonly index: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  // `| undefined` because the rows arrive parsed by Zod, which types an absent key that way.
  readonly where?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly hint?: string | undefined;
  readonly openable: boolean;
}

/** A brief, one of the app's own files, or a text file (`DocumentState.kind`). */
export type ProblemsKind =
  'brief' | 'settings' | 'keybindings' | 'snippets' | 'text' | 'markdown' | 'recipe';

/** The sentence the empty panel says, by what it is about. */
const EMPTY_KEYS: Readonly<Record<ProblemsKind, CatalogueKey>> = {
  brief: 'problems.empty',
  settings: 'problems.empty.settings',
  keybindings: 'problems.empty.keybindings',
  snippets: 'problems.empty.snippets',
  // TYTO-247, ADR 0132: nothing checks a text file, and the panel says so rather than "nothing
  // to report", which would read as a check that passed.
  text: 'problems.empty.text',
  markdown: 'problems.empty.text',
  // TYTO-377: a recipe is checked, by its run, so an empty panel is a check that passed.
  recipe: 'problems.empty.recipe',
};

const EMPTY_STATE: ProblemsState = {
  diagnostics: [],
  brief: '',
  locale: DEFAULT_LOCALE,
  kind: 'brief',
};

const SEVERITY_KEY = {
  error: 'problems.severity.error',
  warning: 'problems.severity.warning',
  info: 'problems.severity.info',
} as const;

/**
 * What makes two rows the same row across an update.
 *
 * The code and the span, **never the index**. A fixed error removes a row from the middle
 * and every row below it shifts up, and a key carrying the index would change for all of
 * them — which is exactly the repaint the element exists to avoid. A `Diagnostic` has no id
 * and inventing one would mean `core` carrying a field only a panel wants.
 *
 * The counter is for the one case the pair does not settle: two diagnostics with the same
 * code over the same span, which `repeat` would otherwise see as one key twice. Counting
 * occurrences keeps the key stable for every list that has no duplicate — which is every
 * list in practice — and stays unique for the one that does.
 */
function rowKeys(): (item: Diagnostic) => string {
  const seen = new Map<string, number>();
  return (item) => {
    const base = `${item.code}:${String(item.range?.start ?? -1)}:${String(item.range?.end ?? -1)}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${String(count)}`;
  };
}

export class ProblemsPanel extends LitElement {
  static override properties = {
    state: { attribute: false },
    reveal: { attribute: false },
    open: { attribute: false },
  };

  declare state: ProblemsState;

  /**
   * What a row does when it is clicked — set by `main.ts`, because moving the cursor means
   * holding the editor and this element holds none.
   *
   * A callback and not a `CustomEvent`: the range travels as the object the diagnostic
   * already carries, where the hand-written panel had to write it into two `data-` attributes
   * and parse them back out on the way. Those attributes, and the `closest()` that read them,
   * are what this property deletes.
   */
  declare reveal: (range: SourceRange) => void;

  /**
   * What a command's row does when clicked: main opens its file by run and row, never by a
   * path the window names (ADR 0113), and `main.ts` then puts the cursor on the line.
   */
  declare open: (runId: string, row: CommandProblemRow) => void;

  constructor() {
    super();
    this.state = EMPTY_STATE;
    this.reveal = () => undefined;
    this.open = () => undefined;
  }

  /**
   * Renders into the element itself rather than into a shadow root.
   *
   * A shadow root would give this panel its own stylesheet, which sounds like the point of a
   * component and is the wrong trade here: TYTO-96 is about one visual language for the whole
   * window, and a panel whose colours came from somewhere `shell.css` could not reach would
   * be the first thing to drift out of it. Encapsulation is not what this element is for.
   */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private row(item: Diagnostic): TemplateResult {
    const say = (key: CatalogueKey): string => translate(this.state.locale, key);
    const severity = say(SEVERITY_KEY[item.severity]);

    // The dot carries the colour and the word carries the meaning. A colour alone is not a
    // severity to somebody who cannot see it, and this is the whole of the difference.
    const body = html`<span
        class="problems__dot problems__dot--${item.severity}"
        aria-label=${severity}
        title=${severity}
      ></span>
      <code class="problems__code">${item.code}</code>
      <span class="problems__message">${item.message}</span>
      ${this.where(item)}`;

    const title = item.hint !== undefined && item.hint !== '' ? item.hint : nothing;
    const range = item.range;

    // A diagnostic with no `range` is about the project rather than about a span of the
    // brief — an unreadable template folder, a format file that does not parse. It is still
    // listed, because it is still the reason nothing renders, and it is not a button,
    // because there is nowhere for it to take you.
    if (range === undefined) {
      return html`<div class="problems__row" title=${title}>${body}</div>`;
    }

    return html`<button
      type="button"
      class="problems__row"
      title=${title}
      @click=${() => {
        this.reveal(range);
      }}
    >
      ${body}
    </button>`;
  }

  private where(item: Diagnostic): TemplateResult {
    if (item.range === undefined) {
      return html`<span
        class="problems__where"
        title=${translate(this.state.locale, 'problems.nowhere')}
        >—</span
      >`;
    }
    const at = lineColumnAt(this.state.brief, item.range.start);
    return html`<span
      class="problems__where"
      title=${translate(this.state.locale, 'problems.location')}
      >${String(at.line)}:${String(at.column)}</span
    >`;
  }

  /** A command's row: its file and line as the command printed them, since it is not the brief's. */
  private commandRow(runId: string, item: CommandProblemRow): TemplateResult {
    const severity = translate(this.state.locale, SEVERITY_KEY[item.severity]);
    const place =
      item.where === undefined
        ? '—'
        : item.line === undefined
          ? item.where
          : `${item.where}:${String(item.line)}:${String(item.column ?? 1)}`;
    const body = html`<span
        class="problems__dot problems__dot--${item.severity}"
        aria-label=${severity}
        title=${severity}
      ></span>
      <code class="problems__code">${item.code}</code>
      <span class="problems__message">${item.message}</span>
      <span class="problems__where">${place}</span>`;
    const title = item.hint !== undefined && item.hint !== '' ? item.hint : nothing;

    if (!item.openable) return html`<div class="problems__row" title=${title}>${body}</div>`;
    return html`<button
      type="button"
      class="problems__row"
      title=${title}
      @click=${() => {
        this.open(runId, item);
      }}
    >
      ${body}
    </button>`;
  }

  private commandSections(): TemplateResult[] {
    return (this.state.commands ?? []).map(
      (command) =>
        html`<p class="problems__command">${command.label}</p>
          ${repeat(
            command.diagnostics,
            (item) => item.index,
            (item) => this.commandRow(command.runId, item),
          )}`,
    );
  }

  /**
   * Diagnostics in the order the stages produced them, which is the order to read them in.
   *
   * Not sorted by severity, and not by position. The stages run in pipeline order and each
   * one reports as it goes, so the list already reads as "what went wrong, first thing
   * first" — and an author fixing the first error usually removes the four that followed
   * from it. Sorting by severity would put the consequence above the cause.
   */
  protected override render(): unknown {
    if (this.state.diagnostics.length === 0) {
      // On one line, and it has to stay on one line: `textContent` would otherwise carry the
      // indentation of this file, and the panel's empty state is a string a test compares.
      const key = EMPTY_KEYS[this.state.kind ?? 'brief'];
      return html`<p class="problems__empty">${translate(this.state.locale, key)}</p>
        ${this.commandSections()}`;
    }

    return html`${repeat(this.state.diagnostics, rowKeys(), (item) => this.row(item))}
    ${this.commandSections()}`;
  }
}

customElements.define(PROBLEMS_TAG, ProblemsPanel);

declare global {
  interface HTMLElementTagNameMap {
    [PROBLEMS_TAG]: ProblemsPanel;
  }
}
