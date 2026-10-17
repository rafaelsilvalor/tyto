# 0097 — A `|` line's columns are read as `fields()` reads them

Status: accepted · 2026-10-17 · TYTO-298

## Context

A table template — `agenda-semana`, the approved list — reads a block's lines as rows and cuts
each at `|` (`fields()` in `packages/template-kit/src/rows.ts`, ADR 0016's "the line is the
`Break`"). In the editor a line such as
`16/09 - 14:00 | Farmacologia Geral | Profª. Marcela Rocha` was plain text: nothing told one
column from the next, and nothing said which `|` the template would split at.

`|` is not in the grammar. It is a character of `Text`, and only a template gives it a meaning;
the language has no escape for it. `fields()` cuts only top-level plain text: a `**bold**`,
`*italic*` or `{cor:x}…{/}` is atomic and joins whichever field is open, `|` and all.

Three looks were measured on one brief in four themes (Tyto Light, Tyto Dark, Dracula
(adjusted), Solarized Light (adjusted)), in the real window, with the contrast each painted read
off `getComputedStyle`, and against the token files of all thirteen built-in and adjusted
themes:

| Look      | What it paints                                                 | Floor        | Under the floor |
| --------- | -------------------------------------------------------------- | ------------ | --------------- |
| separator | the separator in `syntax-function`                             | 3:1 (a mark) | 0 of 13         |
| alternate | that, and even columns in `text-muted`                         | 4.5:1        | 0 of 13         |
| perColumn | columns cycling `syntax-keyword`, `syntax-constant`, `warning` | 4.5:1        | 7 of 13         |

`alternate` passes its floor, but legibility is not distinction: `text-muted` is within 1.5:1 of
`text` in eight of thirteen themes, and in Solarized Light and Dark (adjusted) and Tokyo Night
Light (adjusted) it is as strong as the text or stronger (1.20, 1.24, 1.00:1). Rafael chose all
of them as a setting (2026-10-17).

## Decision

**1. The editor reads the tree the way `fields()` reads the AST** (`packages/editor/src/columns.ts`).
For each `InlineBody` and `BlockText` — an inline body is a line like any other — the top-level
inlines are cut into rows at each top-level `Break`, so columns restart on every line and at a
`\` hard break. A `|` splits only inside a top-level `Text`. A row with no `|` gets nothing: to a
grouped table it is a heading. There is no `\|` escape because the language has none.

**2. A column's colour is painted on its plain text only.** `Text`, `Space` and
`EscapedDirective` are painted; `Bold`, `Italic` and `Mark` are not, and neither is anything
inside them. Emphasis looks the same in every column and every look, and a `|` inside it — which
`fields()` does not split at — is drawn as the emphasis is. That keeps the editor from
suggesting a split the template will not make.

**3. `briefColumns` is a setting with four values** (`apps/desktop/shared/brief-columns.ts`):
`off`; `separator`, the default, the one look that passes its floor in every theme;
`alternate`; and `perColumn`. Each value's description says what it does, and the last two say
plainly what the measurement found — that the muted colour can barely differ from the text, and
that some themes draw a column below comfortable reading contrast. It is commented out, with the
four looks, in a new `settings.json`, offered by the settings tab (TYTO-304), and delivered on
`theme:current` into a compartment through `setBriefColumns`, applied live in every pane and in a
tab shown later, as `indentGuides` and `tabSize` are.

**4. No new token, and no contrast warning.** Every look paints with a role the theme already
sets; the theme files stay at forty-two tokens. A theme where `perColumn` reads poorly is a
choice the description already warned about, not a diagnostic.

**5. One stylesheet for every look; the look chooses the classes.** CodeMirror never unmounts a
theme's rules, so a sheet per look would leave its colours behind after a switch. The marks
carry `cm-brief-column-separator`, `cm-brief-column-even` or `cm-brief-column-cycle-<n>`, and
`off` mounts nothing.

## Consequences

- The marks are recomputed over the visible ranges on every transaction, not only on edits,
  because a background parse that reaches further arrives as a transaction with no changes.
- A JSON tab and the template mode's buffers are not briefs: the plugin checks the language and
  draws nothing. The template mode is not told the setting.
- If the language ever gains an escape for `|`, or `fields()` starts splitting inside emphasis,
  this module has to change with it; the two readings are kept in step by hand.
