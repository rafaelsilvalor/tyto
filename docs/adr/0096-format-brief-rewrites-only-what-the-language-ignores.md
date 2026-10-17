# 0096 — Format Brief rewrites only what the language ignores; trailing spaces at the end of a text line stop meaning anything

Status: accepted · 2026-10-17 · TYTO-297 · beside ADR 0004, ADR 0074, ADR 0087 and ADR 0088

## Context

Briefs arrive pasted from WhatsApp, spreadsheets and other editors: bodies indented by a tab,
three spaces or six, spaces at the end of lines, three blank lines between two groups. All of it
reads the same to the parser except one thing. Measured on origin/main on 2026-10-17: a trailing
space at the end of a line of text reached the Scene — `Profª. Mara Rebeiro  ` became a
`TextSpan` with its two spaces, and a centred line was drawn a little left of the centre. Nobody
can see those spaces in the editor, so they cannot be what the author meant.

TYTO-297 asked for a command that tidies a brief. A formatter that changes what a brief says is a
formatter nobody can run without checking the artwork afterwards, so the question was what it
may touch.

Rafael chose (2026-10-17, option B) to make trailing spaces meaningless in the language rather
than leave the formatter unable to remove them, and approved the plan below with the coordinator.

## Decision

1. **Spaces and tabs at the end of a line of text say nothing.** `parseBrief` trims the `[ \t]`
   the last text of each body line ends with — the inline body and every line of a block — before
   the `Break` between two lines and at the end of the body. ADR 0087's reasoning, carried from a
   blank line to the end of a line with text. Only text is trimmed: a line ending in bold, a mark
   or a `\` break ends in markup, and the spaces before a `\` are inside the line.
2. **Format Brief rewrites only what the language ignores**, so the Scene before and after is the
   same: the indent of each body line becomes exactly `indentUnit` spaces (the `tabSize` setting,
   2 by default); no line ends in spaces or tabs; a run of blank lines becomes one empty line, and
   none is kept between a directive's head and its first body line, before the first line or
   after the last; every line ends in the file's own line ending (the first one it uses), the
   last line included. **Nothing inside a line changes** — not the spacing after a name, not a
   `|`, not a mark, an escape or a `\` break (TYTO-298 is where in-line spacing would be decided).
   The frontmatter is left byte for byte but for the spaces its lines end with, and not even those
   when trimming them would change what its YAML says (a literal block scalar keeps them).
3. **A brief with a syntax error is refused, not guessed at.** `formatBrief` returns the
   `E_SYNTAX` (or `E_FRONTMATTER_SYNTAX`) diagnostics instead of text; what it would move is
   exactly what the parser could not place. The window says so in the status bar for a few
   seconds and makes no edit.
4. **The formatter is pure and returns edits.** `formatBriefEdits` in `@tyto/brief-lang` (no Node,
   no DOM) reads the Lezer tree — a body line is one whose `BlockText` starts on it — and answers
   sorted, non-overlapping whitespace edits; `formatBrief` applies them. The editor dispatches
   the edits as one transaction with its own history event (`isolateHistory`), so one Ctrl+Z takes
   the whole format back and the caret stays on the character it was on.
5. **One command, one key, one setting for each half.** `editor.formatBrief` ("Format Brief",
   "Arrumar brief") is brief-only and a text command, bound to `Alt-Shift-f` — VS Code's "Format
   Document" on Windows and Linux — in both input modes in the keybinding table (ADR 0074). The
   key is free in the table, in CodeMirror's keymaps and in vim, which binds no Alt key.
   `formatBriefOnSave` (default false) formats a brief before Save writes it; a brief that refuses
   is saved as it is. `tabSize` (default 2, 1 to 8, spaces only) is what Tab inserts, how wide a
   tab is drawn, the indent guides' step (ADR 0088) and the indent Format Brief writes; it rides
   on `theme:current` into a compartment, like `indentGuides`, and applies with no restart.

## Consequences

- A brief that had trailing spaces at the end of a line of text renders slightly differently: a
  centred line goes back to the centre. That is the fix, and the changeset says so.
- The guarantee is held by tests, not by reading: every fixture in `brief-lang` and every built-in
  template's example, written messily (tabs, three- and six-space indents, trailing spaces,
  blank-line runs, CRLF) and formatted at indents of 2 and 4, compiles to the same Scene
  (`tools/contract-test`), and formatting twice gives what formatting once gave.
- The window's editor model is LF (CodeMirror splits on every line ending), so in the window the
  line-ending rule is a no-op; it matters to the pure function and to any host that keeps CRLF.
- The indent guides redraw when the unit or the tab width changes with no edit to go with it;
  before, `tabSize` 4 → 2 left them one level per line until the next keystroke.
- In-line spacing (`::titulo   Agenda`, spaces around `|`) is left for TYTO-298.
