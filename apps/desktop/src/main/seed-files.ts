import type { Locale } from '../../shared/i18n/index.js';

/**
 * What `keybindings.json` and `snippets.json` hold when the app creates them, in the window's
 * language (TYTO-334).
 *
 * The notes are the file's first lines and the only explanation a person gets before the editor's
 * hover help, so a Portuguese window wrote them in English until this card. They are whole texts
 * per locale rather than catalogue keys: each is several lines of comment around JSON whose ids,
 * field names and examples are the same in every language, and a `Record<Locale, …>` makes a
 * locale added later a type error here until somebody writes its notes.
 *
 * `settings.json`'s notes stay English and stay in `index.ts`: they come with the setting
 * descriptions, which TYTO-319 owns.
 *
 * Only comments change between languages. Each file still parses, as JSON with comments, to an
 * empty list and an empty object, which `seed-files.test.ts` holds.
 */

const KEYBINDINGS: Record<Locale, string> = {
  en:
    '// Tyto keybindings: JSON with comments. Saving this file applies it, with no restart.\n' +
    '// Each entry is { "key": "ctrl+shift+e", "command": "<id>", "when": "<context>" };\n' +
    '// "command": "-<id>" removes a default binding. The command bar lists every id.\n' +
    '[\n]\n',
  'pt-BR':
    '// Atalhos de teclado do Tyto: JSON com comentários. Salvar este arquivo já aplica, sem reiniciar.\n' +
    '// Cada entrada é { "key": "ctrl+shift+e", "command": "<id>", "when": "<contexto>" };\n' +
    '// "command": "-<id>" remove um atalho padrão. A barra de comandos lista todos os ids.\n' +
    '[\n]\n',
};

const SNIPPETS: Record<Locale, string> = {
  en:
    "// Tyto snippets: JSON with comments, in VS Code's shape. Saving this file applies it.\n" +
    '// Each entry is "Name": { "prefix": "aula", "body": ["::aula ${1:titulo}", "::prof ${2:nome}"],\n' +
    '// "description": "...", "template": "<only while a brief names this template>" }.\n' +
    '// Type the prefix at the start of a line, or "/" there, and Tab moves between its fields.\n' +
    '{\n}\n',
  'pt-BR':
    '// Trechos do Tyto: JSON com comentários, no formato do VS Code. Salvar este arquivo já aplica.\n' +
    '// Cada entrada é "Nome": { "prefix": "aula", "body": ["::aula ${1:titulo}", "::prof ${2:nome}"],\n' +
    '// "description": "...", "template": "<só enquanto um brief usa este template>" }.\n' +
    '// Digite o prefixo no começo de uma linha, ou "/" ali, e o Tab passa de um campo para o outro.\n' +
    '{\n}\n',
};

/** `keybindings.json` as "Open Keyboard Shortcuts (JSON)" creates it (TYTO-207, ADR 0074). */
export function newKeybindingsFile(locale: Locale): string {
  return KEYBINDINGS[locale];
}

/** `snippets.json` as "Open Snippets (JSON)" creates it (TYTO-277, ADR 0082). */
export function newSnippetsFile(locale: Locale): string {
  return SNIPPETS[locale];
}
