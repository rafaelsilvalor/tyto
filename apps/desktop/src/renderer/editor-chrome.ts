import { type LanguageName } from '@tyto/editor';

import { type CatalogueKey } from '../../shared/i18n/index.js';
import { BRIEF_ONLY_COMMANDS } from './commands.js';
import { type DocumentState } from './documents.js';
import { planTemplateEdit, type TemplateEdit } from './frontmatter.js';
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
