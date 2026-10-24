import { type JsoncText, readJsoncText } from './jsonc-text.js';

/**
 * `.tyto/project.json` as text a person wrote: JSON with comments, read with the place of
 * every top-level key (TYTO-278, ADR 0112).
 *
 * The same reader the window gives `settings.json` (ADR 0073, TYTO-350): see `jsonc-text.ts`.
 * What is this file's own is the code its syntax errors carry and what a text that is not an
 * object is told.
 */

export type ProjectText = JsoncText;

/** The top-level keys of a project text, with their ranges. Never fails. */
export function readProjectText(text: string): ProjectText {
  return readJsoncText(text, {
    syntaxCode: 'E_PROJECT_SYNTAX',
    notAnObject: 'it is not an object of keys',
  });
}
