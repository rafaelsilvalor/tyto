import { type LanguageName } from '@tyto/editor';

import { BRIEF_ONLY_COMMANDS, TEXT_COMMANDS } from './commands.js';
import { type DocumentState } from './documents.js';
import { planTemplateEdit, type TemplateEdit, templateOf } from './frontmatter.js';

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
  /**
   * Whether choosing a template may edit this tab's text — the "/" menu's rows. It was also
   * whether the template picker showed, until the picker left the window (TYTO-288).
   */
  readonly templateEdits: boolean;
  /**
   * Whether the commands that act on a brief (`BRIEF_ONLY_COMMANDS`) are offered and run
   * (TYTO-283). Read through {@link commandOffered}, never field by field at a call site.
   */
  readonly briefCommands: boolean;
  /**
   * Whether the commands that act on the text in front (`TEXT_COMMANDS`) are: not with a
   * preview tab in front, whose group shows no text (TYTO-287).
   */
  readonly textCommands: boolean;
}

/** What the tab in front holds: a document's kind, or a brief's preview (TYTO-287). */
export type TabKind = DocumentState['kind'] | 'preview';
type Kind = TabKind;

const BRIEF: EditorChrome = {
  templateEdits: true,
  briefCommands: true,
  textCommands: true,
};

/**
 * An app file's tab: no picker and no brief commands. The editor panel used to name the file in
 * its heading too; that bar is gone (TYTO-288, ADR 0085) and the status bar's kind says it.
 */
const APP_FILE: EditorChrome = {
  templateEdits: false,
  briefCommands: false,
  textCommands: true,
};

export function editorChromeFor(kind: Kind): EditorChrome {
  switch (kind) {
    case undefined:
      return BRIEF;
    case 'preview':
      // A brief's art: every command on the brief still runs, on that brief; the picker and the
      // text commands act on text, which is not in front.
      return { ...BRIEF, templateEdits: false, textCommands: false };
    case 'settings':
    case 'keybindings':
    case 'snippets':
      return APP_FILE;
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
export const commandOffered = (kind: Kind, id: string): boolean => {
  const chrome = editorChromeFor(kind);
  if (!chrome.briefCommands && BRIEF_ONLY_COMMANDS.has(id)) return false;
  return chrome.textCommands || !TEXT_COMMANDS.has(id);
};

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
  if (!editorChromeFor(kind).templateEdits || template === '') return undefined;
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
  if (!editorChromeFor(kind).templateEdits || template === '') return undefined;
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
