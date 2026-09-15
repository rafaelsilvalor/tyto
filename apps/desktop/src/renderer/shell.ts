import {
  type CatalogueKey,
  type Locale,
  CATALOGUE_KEYS,
  LOCALES,
  isLocale,
  translate,
} from '../../shared/i18n/index.js';

/**
 * The shell, which is an empty window with every string in it coming from the catalogue.
 *
 * E9.1 opens a window and proves the wiring; the editor, the preview and the panels arrive
 * with the cards that build them. What is here is the part those cards will all depend on
 * and none of them should have to invent: **no element carries a literal**. Every piece of
 * text is written by `paint` from a `data-i18n` key, which is what makes "switching locale
 * changes every visible string" a property a test can check rather than a habit somebody
 * has to keep.
 *
 * Deliberately no framework. `docs/architecture.md` has the renderer holding a CodeMirror
 * editor, a preview and panels, and which framework wraps them is E9.2's decision to make
 * with a real screen in front of it — not a dependency this card adds on the way past.
 */

/** The attribute that marks an element as text the catalogue owns. */
export const I18N_ATTRIBUTE = 'data-i18n';

/**
 * The same, for a control whose visible label is a glyph.
 *
 * The zoom buttons read `−` and `+`, which are the right thing to *see* and nothing at all
 * to hear. This puts the catalogue's words on `title` and `aria-label` instead of replacing
 * the glyph, so the button stays a button and stops being anonymous to a screen reader.
 */
export const I18N_TITLE_ATTRIBUTE = 'data-i18n-title';

export interface ShellState {
  readonly locale: Locale;
  readonly version: string;
  readonly platform: string;
  readonly templates: readonly string[];
  /** What is open and whether it has been touched since it was last written (E9.8). */
  readonly document: DocumentState;
}

export interface DocumentState {
  /** The file's name, or nothing for a brief that has never been saved. */
  readonly name: string | undefined;
  readonly dirty: boolean;
}

/**
 * The window's title, which is the whole of how "did I save this" is answered.
 *
 * A word and not a bullet for the dirty marker. `•` is what every editor uses and it is
 * nothing at all to a screen reader or to somebody who has not learned the convention; a
 * title is plain text and has room for the word. The file's name is never translated — it
 * is what the person called it.
 */
export function windowTitle(state: ShellState): string {
  const app = translate(state.locale, 'app.name');
  const name = state.document.name ?? translate(state.locale, 'document.untitled');
  const mark = state.document.dirty ? ` (${translate(state.locale, 'document.unsaved')})` : '';
  return `${name}${mark} — ${app}`;
}

/**
 * Values spliced into a string after it is translated.
 *
 * Only two, and both are facts about the machine rather than prose: a version and a
 * platform name are the same in every language. Anything that needs a *sentence* built
 * around a value gets a key of its own instead, because word order is exactly what a
 * translation changes.
 */
const detailOf = (key: CatalogueKey, state: ShellState): string | undefined => {
  if (key === 'shell.about.version') return state.version;
  if (key === 'shell.about.platform') return state.platform;
  // A count and not the names: the list is what E9.2's picker shows, and a footer that grew
  // with the number of installed packs would be a layout that breaks on somebody else's
  // machine.
  if (key === 'shell.about.templates') return String(state.templates.length);
  return undefined;
};

/**
 * Writes every catalogue-owned element in the document, in one pass.
 *
 * One pass over `[data-i18n]` rather than a render per component: the elements are the
 * source of truth for what is on screen, so nothing can be visible and unpainted. A key
 * that is not in the catalogue is left alone rather than blanked — an element showing a
 * stale string is recoverable, an element showing nothing is not.
 */
export function paint(root: ParentNode, state: ShellState): void {
  for (const element of root.querySelectorAll(`[${I18N_ATTRIBUTE}]`)) {
    const key = element.getAttribute(I18N_ATTRIBUTE);
    if (key === null || !isCatalogueKey(key)) continue;
    const detail = detailOf(key, state);
    const text = translate(state.locale, key);
    element.textContent = detail === undefined ? text : `${text}: ${detail}`;
  }

  for (const element of root.querySelectorAll(`[${I18N_TITLE_ATTRIBUTE}]`)) {
    const key = element.getAttribute(I18N_TITLE_ATTRIBUTE);
    if (key === null || !isCatalogueKey(key)) continue;
    const text = translate(state.locale, key);
    element.setAttribute('title', text);
    element.setAttribute('aria-label', text);
  }

  const title = root.querySelector('title');
  if (title !== null) title.textContent = windowTitle(state);

  const html = (root as Document).documentElement as HTMLElement | undefined;
  if (html !== undefined) html.lang = state.locale;
}

function isCatalogueKey(value: string): value is CatalogueKey {
  return (CATALOGUE_KEYS as readonly string[]).includes(value);
}

/**
 * Fills the language picker, and reports what the user chose.
 *
 * The option labels are the locale's own name, written in that locale, and are therefore
 * *not* in the catalogue: "Português (Brasil)" is what a Portuguese speaker looks for in a
 * list, whatever language the rest of the window is in. A translated language list is the
 * one list that is harder to use translated.
 */
const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
};

export function fillLocalePicker(picker: HTMLSelectElement, current: Locale): void {
  picker.replaceChildren(
    ...LOCALES.map((locale) => {
      const option = picker.ownerDocument.createElement('option');
      option.value = locale;
      option.textContent = LOCALE_NAMES[locale];
      option.selected = locale === current;
      return option;
    }),
  );
}

export function localeFromPicker(picker: HTMLSelectElement, fallback: Locale): Locale {
  return isLocale(picker.value) ? picker.value : fallback;
}
