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
}

const EMPTY_STATE: ProblemsState = { diagnostics: [], brief: '', locale: DEFAULT_LOCALE };

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

  constructor() {
    super();
    this.state = EMPTY_STATE;
    this.reveal = () => undefined;
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
      return html`<p class="problems__empty">${translate(this.state.locale, 'problems.empty')}</p>`;
    }

    return repeat(this.state.diagnostics, rowKeys(), (item) => this.row(item));
  }
}

customElements.define(PROBLEMS_TAG, ProblemsPanel);

declare global {
  interface HTMLElementTagNameMap {
    [PROBLEMS_TAG]: ProblemsPanel;
  }
}
