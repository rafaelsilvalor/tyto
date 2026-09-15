import { type IpcResponse } from '../../shared/ipc.js';
import { type Locale, translate } from '../../shared/i18n/index.js';

/**
 * The bottom panel and the template picker: what the compiler said, and what it compiled
 * against (E9.3).
 *
 * The same split `preview.ts` makes — every function here takes state and a node and knows
 * nothing about the bridge — and for the same reason: the interesting parts are testable in
 * jsdom, and the one thing jsdom cannot check is the one thing a real window has to be
 * opened for. What a click *does* is `main.ts`'s, because moving the cursor means holding
 * the editor, and this module holds none.
 *
 * The panel's hard requirement is the card's acceptance criterion: **clicking a diagnostic
 * puts the cursor exactly at the reported range**. Exactly is the load-bearing word. A
 * diagnostic's `range` is an offset pair into the text the caller handed the parser
 * (`docs/brief-language.md` is emphatic about why they are not normalised), and the editor
 * holds that same text — so the offsets travel as offsets, and nothing here converts them to
 * a line and a column except to *show* them.
 */

export type Diagnostic = IpcResponse<'brief:preview'>['diagnostics'][number];
export type Artwork = IpcResponse<'brief:preview'>['artworks'][number];
export type Template = IpcResponse<'templates:list'>['templates'][number];

/** Where a click's target carries the range it should select. */
export const RANGE_START_ATTRIBUTE = 'data-range-start';
export const RANGE_END_ATTRIBUTE = 'data-range-end';

/** One-based, the way an editor's gutter counts and the way `core` reports a position. */
export interface LineColumn {
  readonly line: number;
  readonly column: number;
}

/**
 * The line and column an offset falls on, counting all three line endings as one break.
 *
 * Its own small scan rather than `createLineIndex` from `@tyto/core`: the panel converts one
 * offset per diagnostic, a handful per paint, and reaching for the indexed version would
 * make the renderer import a package it otherwise has no reason to load into the window.
 * The counting rule is the same one, and `docs/brief-language.md` fixes it — `\r\n`, `\n`
 * and a lone `\r` each end exactly one line.
 */
export function lineColumnAt(text: string, offset: number): LineColumn {
  const upTo = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < upTo; index += 1) {
    const character = text[index];
    if (character !== '\n' && character !== '\r') continue;
    // `\r\n` is one ending, so the `\n` after a `\r` is not a second one.
    if (character === '\r' && text[index + 1] === '\n') continue;
    line += 1;
    lineStart = index + 1;
  }

  return { line, column: upTo - lineStart + 1 };
}

/**
 * Diagnostics in the order the stages produced them, which is the order to read them in.
 *
 * Not sorted by severity, and not by position. The stages run in pipeline order and each one
 * reports as it goes, so the list already reads as "what went wrong, first thing first" —
 * and an author fixing the first error usually removes the four that followed from it.
 * Sorting by severity would put the consequence above the cause.
 */
export interface ProblemsState {
  readonly diagnostics: readonly Diagnostic[];
  /** The brief the diagnostics were computed against, for turning an offset into a line. */
  readonly brief: string;
  readonly locale: Locale;
}

const SEVERITY_KEY = {
  error: 'problems.severity.error',
  warning: 'problems.severity.warning',
  info: 'problems.severity.info',
} as const;

/**
 * Rewrites the list of problems.
 *
 * A `<button>` per diagnostic and not a `<li>` with a click handler: the whole of what this
 * row does is move the cursor somewhere, which is a button, and getting that right is what
 * makes the panel reachable by keyboard without a single `tabindex`.
 *
 * A diagnostic with no `range` is about the project rather than about a span of the brief —
 * an unreadable template folder, a format file that does not parse. It is still listed,
 * because it is still the reason nothing renders, and it is not a button, because there is
 * nowhere for it to take you.
 */
export function paintProblems(list: HTMLElement, state: ProblemsState): void {
  const document_ = list.ownerDocument;
  const say = (key: Parameters<typeof translate>[1]): string => translate(state.locale, key);

  if (state.diagnostics.length === 0) {
    const empty = document_.createElement('p');
    empty.className = 'problems__empty';
    empty.textContent = say('problems.empty');
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(
    ...state.diagnostics.map((item) => {
      const row = document_.createElement(item.range === undefined ? 'div' : 'button');
      row.className = 'problems__row';
      if (row instanceof HTMLButtonElement) {
        row.type = 'button';
        row.setAttribute(RANGE_START_ATTRIBUTE, String(item.range?.start ?? 0));
        row.setAttribute(RANGE_END_ATTRIBUTE, String(item.range?.end ?? 0));
      }

      const dot = document_.createElement('span');
      dot.className = `problems__dot problems__dot--${item.severity}`;
      // The dot carries the colour and the word carries the meaning. A colour alone is not
      // a severity to somebody who cannot see it, and this is the whole of the difference.
      dot.setAttribute('aria-label', say(SEVERITY_KEY[item.severity]));
      dot.setAttribute('title', say(SEVERITY_KEY[item.severity]));

      const code = document_.createElement('code');
      code.className = 'problems__code';
      // `E_UNKNOWN_SLOT` is the catalogue's own name for the problem
      // (`docs/diagnostic-codes.md`) and is the string an author searches the docs for.
      // Translating it would break the one link between the panel and the documentation.
      code.textContent = item.code;

      const message = document_.createElement('span');
      message.className = 'problems__message';
      // Already in the user's language, because `@tyto/core` writes it that way; the panel
      // does not compose a sentence around it, which is what would need a translator.
      message.textContent = item.message;

      const where = document_.createElement('span');
      where.className = 'problems__where';
      if (item.range === undefined) {
        where.textContent = '—';
        where.setAttribute('title', say('problems.nowhere'));
      } else {
        const at = lineColumnAt(state.brief, item.range.start);
        where.textContent = `${String(at.line)}:${String(at.column)}`;
        where.setAttribute('title', say('problems.location'));
      }

      row.append(dot, code, message, where);
      if (item.hint !== undefined && item.hint !== '') row.setAttribute('title', item.hint);
      return row;
    }),
  );
}

/**
 * The range a clicked row names, or nothing when the click missed one.
 *
 * `closest`, because the click lands on the code or the message rather than on the button
 * itself nine times out of ten, and a handler that only read `event.target` would work for
 * the tenth.
 */
export function rangeOf(target: EventTarget | null): { start: number; end: number } | undefined {
  if (!(target instanceof Element)) return undefined;
  const row = target.closest(`[${RANGE_START_ATTRIBUTE}]`);
  if (row === null) return undefined;

  const start = Number(row.getAttribute(RANGE_START_ATTRIBUTE));
  const end = Number(row.getAttribute(RANGE_END_ATTRIBUTE));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return { start, end };
}

export interface TemplatePickerState {
  readonly templates: readonly Template[];
  /** What the brief's frontmatter names right now, which may be none of them. */
  readonly current: string | undefined;
  readonly locale: Locale;
}

/**
 * Fills the template picker from the registry's manifests.
 *
 * The option's text is the manifest's `name` — the string the frontmatter has to contain —
 * and the description goes on `title` rather than into the option, because an option that
 * grew a sentence would make the control as wide as the longest description somebody
 * installed. The formats go there too: they are what the preview's tabs will become, and
 * seeing them before choosing is the difference between picking and guessing.
 *
 * A brief naming a template the registry does not have keeps an option of its own, selected.
 * Dropping it would silently show a different template as the current one, and the brief
 * would still say what it says.
 */
export function paintTemplatePicker(picker: HTMLSelectElement, state: TemplatePickerState): void {
  const document_ = picker.ownerDocument;
  const known = state.templates.some((template) => template.name === state.current);

  const options: HTMLOptionElement[] = [];

  if (state.current === undefined || !known) {
    const none = document_.createElement('option');
    // The name it carries, not an empty value, for a template the registry does not have:
    // the control's `value` is what a reader compares against the brief, and a blank there
    // would say the brief names nothing while the option beside it says otherwise.
    none.value = state.current ?? '';
    none.textContent =
      state.current === undefined ? translate(state.locale, 'template.none') : state.current;
    none.selected = true;
    options.push(none);
  }

  options.push(
    ...state.templates.map((template) => {
      const option = document_.createElement('option');
      option.value = template.name;
      option.textContent = template.name;
      const detail = [template.description, template.formats.join(', ')].filter(
        (part) => part !== undefined && part !== '',
      );
      if (detail.length > 0) option.title = detail.join(' — ');
      option.selected = template.name === state.current;
      return option;
    }),
  );

  picker.replaceChildren(...options);
}

/**
 * The artwork list, from the artworks the brief produced rather than from the frames.
 *
 * They differ, and the difference is the point: a slide that renders only to `story` has no
 * `feed` frame, and deriving the list from frames would make it change when somebody clicks
 * a format tab. What the card asks for is a list synced with the repeat directives, and
 * `artworks` is that list.
 */
export interface ArtworkListState {
  readonly artworks: readonly Artwork[];
  readonly selected: string | undefined;
}

export function paintArtworkList(picker: HTMLSelectElement, state: ArtworkListState): void {
  const document_ = picker.ownerDocument;

  picker.replaceChildren(
    ...state.artworks.map((artwork) => {
      const option = document_.createElement('option');
      option.value = artwork.id;
      // A number and not the artwork's id: `slide-1` is the IR's name for it, and a person
      // counting slides in a carousel is counting 1, 2, 3.
      option.textContent = String(artwork.index + 1);
      option.selected = artwork.id === state.selected;
      return option;
    }),
  );
}

/** Where in the brief an artwork was written, for the editor to scroll to. */
export function rangeOfArtwork(
  artworks: readonly Artwork[],
  id: string | undefined,
): { start: number; end: number } | undefined {
  if (id === undefined) return undefined;
  return artworks.find((artwork) => artwork.id === id)?.range;
}

/**
 * As much of a CodeMirror view as moving the cursor needs.
 *
 * Typed structurally rather than imported, the same call `@tyto/fonts` makes about the
 * `FontSource` port: reaching for `EditorView` would make this app depend on
 * `@codemirror/view` directly, when `@tyto/editor` owns that dependency and hands back a
 * view that already satisfies this. It also lets the test drive a real editor **and** a
 * double through one signature.
 */
export interface Revealable {
  readonly state: { readonly doc: { readonly length: number } };
  dispatch(spec: { selection: { anchor: number; head: number }; scrollIntoView: boolean }): void;
  focus(): void;
}

/**
 * Selects `range` in the editor, scrolls it into view and focuses it.
 *
 * The card's acceptance criterion, and **exactly** is the load-bearing word: a diagnostic's
 * range is a pair of offsets into the text the parser was handed, the editor holds that same
 * text, so the offsets travel as offsets and nothing converts them on the way.
 *
 * Clamped, and that is not defensiveness. The panel shows the answer to the brief as it was
 * *compiled*, and the buffer may have moved on — a keystroke that shortened the document
 * between the request and the click is an ordinary event, and a range past the end is a
 * thrown error in CodeMirror rather than a no-op. The clamp turns "the text changed" into a
 * cursor at the end instead of an exception in a click handler.
 *
 * `scrollIntoView` rides on the same transaction, which is what makes this work while the
 * target is off screen: the position has no layout box yet, so nothing a caller could
 * measure would help. Focus last, because the point of clicking a problem is to fix it.
 */
export function revealRange(view: Revealable, range: { start: number; end: number }): void {
  const length = view.state.doc.length;
  const anchor = Math.max(0, Math.min(range.start, length));
  const head = Math.max(anchor, Math.min(range.end, length));

  view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
  view.focus();
}
