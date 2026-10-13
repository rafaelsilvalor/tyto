import { type LanguageName } from '@tyto/editor';

import { type CatalogueKey } from '../../shared/i18n/index.js';
import { BRIEF_ONLY_COMMANDS } from './commands.js';
import { type DocumentState } from './documents.js';
import { planTemplateEdit, type TemplateEdit, templateOf } from './frontmatter.js';
import { I18N_ATTRIBUTE } from './shell.js';

/**
 * What the panels around the editor show for the tab in front (TYTO-256).
 *
 * A brief's tab and an app file's differ in what the window around them offers, not only in
 * the text: `settings.json` names no template and compiles to nothing, so the template picker,
 * the format tabs, the slide and the zoom are controls with nothing to act on, and "Write a
 * brief to see it here" is advice that would make the file wrong. One pure answer per kind,
 * so the decision is tested here and painted in one place.
 */
export interface EditorChrome {
  /** The editor panel's heading. An app file reuses the status bar's word for its kind. */
  readonly heading: CatalogueKey;
  /** Whether the template picker is shown, and whether choosing in it may edit the text. */
  readonly templatePicker: boolean;
  /** Whether the preview shows its format tabs, slide and zoom. */
  readonly previewControls: boolean;
  /** The one muted line the preview shows instead of a picture, for an app file. */
  readonly previewNote: CatalogueKey | undefined;
  /**
   * Whether the commands that act on a brief (`BRIEF_ONLY_COMMANDS`) are offered and run
   * (TYTO-283). Read through {@link commandOffered}, never field by field at a call site.
   */
  readonly briefCommands: boolean;
}

type Kind = DocumentState['kind'];

const BRIEF: EditorChrome = {
  heading: 'editor.heading',
  templatePicker: true,
  previewControls: true,
  previewNote: undefined,
  briefCommands: true,
};

export function editorChromeFor(kind: Kind): EditorChrome {
  switch (kind) {
    case undefined:
      return BRIEF;
    case 'settings':
      return {
        heading: 'status.kind.settings',
        templatePicker: false,
        previewControls: false,
        previewNote: 'preview.note.settings',
        briefCommands: false,
      };
    case 'keybindings':
      return {
        heading: 'status.kind.keybindings',
        templatePicker: false,
        previewControls: false,
        previewNote: 'preview.note.keybindings',
        briefCommands: false,
      };
  }
}

/**
 * Whether the command `id` is offered with a tab of this kind in front (TYTO-283).
 *
 * **The one predicate every door asks**: the command bar's list, the registry's `run` (which is
 * what the bar, a key in the editor, the window's dispatcher, the status bar and a File menu
 * item all reach), and the File menu's enabled flags. Before it, `settings.json` in front
 * opened the export dialog and the run wrote `editaveis/settings.json.brief` and a
 * `result.json` of syntax errors into the chosen folder — measured, not read.
 */
export const commandOffered = (kind: Kind, id: string): boolean =>
  editorChromeFor(kind).briefCommands || !BRIEF_ONLY_COMMANDS.has(id);

/**
 * The language a tab of this kind is opened in. One place for both ways a tab is born — opened
 * from its command and brought back by the session — so the two cannot disagree. `undefined` is
 * the editor's own language, the brief's.
 */
export const languageOf = (kind: Kind): LanguageName | undefined =>
  kind === undefined ? undefined : 'json';

/**
 * The edit choosing `template` in the picker makes to this tab's text, or none.
 *
 * None on an app file **whatever the picker says**, and that guard is the fix rather than the
 * hidden picker: `planTemplateEdit` on a text with no frontmatter inserts a YAML block at the
 * top, which in `settings.json` is a syntax error the person did not type. A hidden control can
 * still be changed by code or by a stale event, so the edit itself refuses.
 */
export function templateEditFor(
  kind: Kind,
  text: string,
  template: string,
): TemplateEdit | undefined {
  if (!editorChromeFor(kind).templatePicker || template === '') return undefined;
  return planTemplateEdit(text, template);
}

/**
 * What choosing `template` in the picker does to this tab (TYTO-275): on a brief with nothing
 * in it, the template's whole skeleton, and on any other the one-line edit above. A blank tab is
 * one with only whitespace — the picker is most used on a brief being started, and a skeleton
 * there is the template's slots instead of a frontmatter the person then fills by memory. The
 * app-file refusal is `templateEditFor`'s, kept for both answers.
 */
export type TemplateChoice =
  { readonly kind: 'skeleton' } | { readonly kind: 'edit'; readonly edit: TemplateEdit };

export function templateChoiceFor(
  kind: Kind,
  text: string,
  template: string,
): TemplateChoice | undefined {
  const edit = templateEditFor(kind, text, template);
  if (edit === undefined) return undefined;
  return text.trim() === '' ? { kind: 'skeleton' } : { kind: 'edit', edit };
}

/**
 * What choosing `template` in the "/" menu does (TYTO-276), as changes to the text as it stands.
 *
 * `from`..`to` is the "/" and its query, which the choice always takes away; everything else is
 * decided on the text **without** them, so a brief holding only "/agen" is an empty brief and
 * gets the skeleton. On a brief with content the one-line edit and the removal are returned
 * together, in the original text's positions, so the window dispatches them as one transaction
 * and one Ctrl+Z takes both back. The template already named leaves only the removal.
 */
export type SlashTemplateChoice =
  { readonly kind: 'skeleton' } | { readonly kind: 'changes'; readonly changes: TemplateEdit[] };

export function slashTemplateChoiceFor(
  kind: Kind,
  text: string,
  from: number,
  to: number,
  template: string,
): SlashTemplateChoice | undefined {
  if (!editorChromeFor(kind).templatePicker || template === '') return undefined;
  const removal: TemplateEdit = { from, to, insert: '' };
  const choice = templateChoiceFor(kind, text.slice(0, from) + text.slice(to), template);
  if (choice === undefined) return { kind: 'changes', changes: [removal] };
  if (choice.kind === 'skeleton') return choice;

  // From the text without the query back to the text with it. The edit is in the frontmatter,
  // which ends before the line the "/" is on, so nothing it touches straddles the removal.
  const back = (position: number): number => (position <= from ? position : position + to - from);
  const { edit } = choice;
  return {
    kind: 'changes',
    changes: [{ from: back(edit.from), to: back(edit.to), insert: edit.insert }, removal],
  };
}

/**
 * What a template's row in the "/" menu says it will do to this brief: start it, set its
 * template, leave it as it is, or switch it — the warning, since a switch keeps slots the new
 * template may not have. A line beside the row rather than a dialog, which was decided.
 */
export type SlashTemplateNote =
  | { readonly key: 'slash.template.new' | 'slash.template.set' | 'slash.template.current' }
  | { readonly key: 'slash.template.switch'; readonly current: string };

export function slashTemplateNote(
  text: string,
  from: number,
  to: number,
  template: string,
): SlashTemplateNote {
  const rest = text.slice(0, from) + text.slice(to);
  if (rest.trim() === '') return { key: 'slash.template.new' };
  const current = templateOf(rest);
  if (current === undefined) return { key: 'slash.template.set' };
  return current === template
    ? { key: 'slash.template.current' }
    : { key: 'slash.template.switch', current };
}

/**
 * Paints the answer into the window's panels, any of which may be closed.
 *
 * The heading's key goes on its `data-i18n` attribute, so the window's translation pass — which
 * runs on every repaint and on a locale switch — writes the word, as it does for every other
 * heading. Run after `paintPreview`, which shows the brief's empty line whenever there is no
 * frame: on an app file there never is one, and the note takes its place.
 */
export function paintEditorChrome(root: ParentNode, chrome: EditorChrome): void {
  root.querySelector('#editor-heading')?.setAttribute(I18N_ATTRIBUTE, chrome.heading);
  const picker = root.querySelector<HTMLElement>('.work__template');
  if (picker !== null) picker.hidden = !chrome.templatePicker;

  for (const selector of ['#format-tabs', '.preview__slide', '.preview__zoom']) {
    const control = root.querySelector<HTMLElement>(selector);
    if (control !== null) control.hidden = !chrome.previewControls;
  }

  if (chrome.previewNote !== undefined) {
    for (const id of ['preview-empty', 'preview-broken', 'preview-stale']) {
      const line = root.querySelector<HTMLElement>(`#${id}`);
      if (line !== null) line.hidden = true;
    }
  }
  for (const note of root.querySelectorAll<HTMLElement>('[data-preview-note]')) {
    note.hidden = note.getAttribute(I18N_ATTRIBUTE) !== chrome.previewNote;
  }
}
