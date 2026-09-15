import { type IpcResponse } from '../../shared/ipc.js';
import { type Locale, translate } from '../../shared/i18n/index.js';

/**
 * The template picker and the artwork list: what the brief compiled against, and what it
 * produced (E9.3).
 *
 * Every function here takes state and a node and knows nothing about the bridge, which is
 * what makes them testable in jsdom; what a click *does* is `main.ts`'s, because moving the
 * cursor means holding the editor and this module holds none.
 *
 * **The problems panel used to live here and is now `problems-panel.ts`** — a Lit element
 * rather than a painter (ADR 0024). What stayed behind is what the element still needs
 * (`lineColumnAt`, the diagnostic types) and the two controls that write into a `<select>`,
 * which a component would not make shorter: an option list is already the shape the DOM
 * wants.
 */

export type Diagnostic = IpcResponse<'brief:preview'>['diagnostics'][number];
export type Artwork = IpcResponse<'brief:preview'>['artworks'][number];
export type Template = IpcResponse<'templates:list'>['templates'][number];

/**
 * A span of the brief, as every stage reports one.
 *
 * Named rather than written inline in four signatures, now that a panel hands one straight
 * to the editor instead of writing it into two `data-` attributes on the way (ADR 0024).
 * Not called `Range`, which is the DOM's own name for something else entirely.
 */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

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
): SourceRange | undefined {
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
export function revealRange(view: Revealable, range: SourceRange): void {
  const length = view.state.doc.length;
  const anchor = Math.max(0, Math.min(range.start, length));
  const head = Math.max(anchor, Math.min(range.end, length));

  view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
  view.focus();
}
