# 0082 — Snippets are a JSONC map in VS Code's shape

Status: accepted · 2026-10-13 · TYTO-277 · builds on ADR 0073 and ADR 0074

## Context

Rafael asked for snippets a person writes once and inserts by typing a word (TYTO-277). Tyto
already has the pattern for a file the person owns, edited in a tab, checked while typing and
applied on save: `settings.json` (ADR 0073) and `keybindings.json` (ADR 0074). VS Code's user
snippets are the model people know, and the snippets they already have are written in its
syntax. CodeMirror, which inserts them, has a snippet syntax of its own (`${1:name}`, `#{}`,
`\{`), close to VS Code's and not the same.

## Decision

1. **The file is `userData/snippets.json`, JSON with comments, beside `settings.json`.** Main
   creates it on first "Preferences: Open Snippets (JSON)" with a comment saying what goes in
   it, watches it with the other two, and pushes its text on `snippets:changed`; it never
   writes it again. The window parses it (`src/renderer/snippets-file.ts`), because the template
   filter below is checked against the window's template list. It travels with the import from
   the previous version (ADR 0036) when it parses into a map.
2. **The shape is VS Code's map by name**, so a VS Code snippet pastes in unchanged:
   `"Name": { "prefix": string | string[], "body": string | string[], "description"?: string,
"template"?: string }`. A list body is joined with line breaks. A prefix is one word of
   letters, digits, `_` and `-`.
3. **The body is translated, and what cannot be translated faithfully is refused by name**
   (`snippetTemplate` in `packages/editor/src/snippets.ts`). `$1` and `${1}` become `${1}`,
   `${1:default}` stays, `$0` is CodeMirror's `${0}`, and `\$`, `\}` and `\\` are the characters
   they escape. **Every literal brace is escaped**: a brief's adjustment is `{destaque}`, and
   CodeMirror reads `${…}` and `#{…}` as fields. A choice `${1|a,b|}` is inserted as `${1:a}`
   with `W_SNIPPET_CHOICE_FLATTENED`, because CodeMirror has no choice field and the first
   option is a usable placeholder. Variables (`$TM_FILENAME`, `${CURRENT_YEAR}`), transforms,
   a field inside a default, and a brace or a line break inside a default are refused with
   `W_SNIPPET_UNSUPPORTED_BODY`: CodeMirror's syntax cannot hold them, and inserting them as
   text would put a VS Code expression into a brief. A diagnostic about a body ranges over the
   whole `body` value, since offsets inside an escaped JSON string would be off by every escape
   before them.
4. **A file that does not parse changes nothing** (`E_SNIPPETS_SYNTAX`); the last snippets that
   read stay offered, as with keybindings. A bad entry costs that entry (`W_SNIPPET_INVALID`).
5. **Where a snippet is offered.** In brief completion, on a word that starts its line, outside
   the frontmatter — a snippet writes lines, and a list on every word of prose that starts like
   a prefix would make Enter insert a block nobody asked for. In the "/" menu, through the `SlashSource`
   seam TYTO-276 left, under its own heading after the templates. Never on an app-file tab or
   in the template mode: both sources sit on the brief language's data facet.
6. **`template` filters**: a snippet that names a template is offered only while the brief in
   front names it (the analysis manifest's name). One naming a template that is not installed
   is `W_SNIPPET_UNKNOWN_TEMPLATE` and kept, since the folder may change.
7. **Tab in an open list moves through it** (Rafael's decision): Tab and Shift+Tab step to the
   next and previous row and Enter accepts; with no list open they fall through to a snippet's
   next field or to indenting. Registered at `Prec.highest` before the snippet's own keymap, so
   a list open while a field is typed takes Tab, as VS Code does.
8. **Templates do not ship snippets in this card.** The manifest stays as it is. A template's
   skeleton (TYTO-275) already covers what a template would most want to insert, and a second
   source of snippets needs a precedence rule and a place in the template mode that nobody has
   asked for yet. The shape above is what a template pack would carry if one ever does.

## Consequences

- A snippet copied from VS Code works unless it uses a variable or a transform, and then the
  problems panel says which and where.
- Snippets are per machine and per version folder; sharing them with a team waits for a project
  folder (the workspace batch).
- The editor reads no file and knows no template list: the host hands it `BriefSnippet`s
  through a getter asked at every opening, so a save needs no reconfigure.
