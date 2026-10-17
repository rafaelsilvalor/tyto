# 0095 — A brief's blocks are one pure list

Status: accepted · 2026-10-17 · TYTO-296

## Context

In a long brief the only way to reach the fifth `::lamina` was scrolling or searching text. VS
Code's "Go to Symbol in Editor" (Ctrl+Shift+O) lists a file's symbols and jumps to one. Three
features want the same answer about a brief — which blocks it has, in what order, and how a
person names each: "Go to Block" (TYTO-296), the breadcrumb (TYTO-273), which names the block
the caret is in, and sticky scroll (TYTO-295), which pins a block's head line.

`parseBrief` cannot be that answer: a brief with one syntax error has no AST at all, and a brief
being typed has one most of the time. The Lezer tree recovers — a directive below a broken line is
still a `Directive` node, sometimes inside an error node.

A brief writes `::lamina` three times and means three slides. A label of `::lamina` three times
tells them apart only by position; the breadcrumb's card numbers them (`::lamina 2`). But whether a
name is numbered is the manifest's to say (`repeat: true`), and a plugin's directive
(`::ai/caption`) is not a slot at all.

## Decision

**1. One pure read, `briefBlocks(tree, slice, manifest?)` in `packages/editor/src/brief-blocks.ts`.**
It takes a Lezer tree and a way to read the text it was parsed from, and only `@lezer/common`
types — so it is unit-tested against `parser.parse(text)` with no editor. It answers the
frontmatter and every top-level `Directive`, in document order, looking through error nodes. A
block is `{ kind, name?, ordinal?, from, headTo, to, firstText? }`.

**2. A directive's `name` is as the brief writes it**: `lamina`, or `ai/caption` with the
namespace's own `/` (the grammar keeps it on `Namespace`, `parseBrief` strips it, this joins them).

**3. `ordinal` only for a slot the manifest says repeats.** Counted per name in document order. No
ordinal for a slot that does not repeat, for a plugin's directive, or while no manifest is known —
a number that might be wrong is worse than none. `blocksOf(state)` takes the manifest from
`briefAnalysisField`, which keeps it across an analysis that failed to parse.

**4. A block ends at its last line with text**, as its fold does (ADR 0094): a blank line between
two lines of text is inside (ADR 0087), a blank or spaces-only line after the last one is not.
`blockAt(blocks, pos)` answers the block whose `from..to` holds `pos`, or none.

**5. `blocksOf` is remembered per syntax tree** (a `WeakMap` keyed by the `Tree`, checked against
the manifest), because the breadcrumb asks on every caret move and a transaction that changes no
text keeps its tree.

**6. `@tyto/editor` names no block.** The frontmatter's row is the window's word ("cabeçalho" /
"header"); the editor only says `kind: 'frontmatter'`.

**7. "Go to Block" is the command bar's picker**, not a widget of its own: `editor.goToBlock`,
`Mod-Shift-o` in both input modes, brief-only and a text command, on the View menu. Moving through
the list previews the block (the caret moves there, the editor keeps no focus); Enter leaves the
caret on the `::`; Escape puts back the selection and scroll the pane had. The picker matches the
labels alone (`CommandBarPick.matchIds: false`), because its ids are offsets.

## Consequences

- TYTO-273's breadcrumb reads `blocksOf` and `blockAt` with no new parsing (ADR 0098), and
  names a directive with the same `directiveLabel` "Go to Block" does. TYTO-295's sticky
  scroll still reads the fold ranges; moving it onto this list is possible and not done here.
- Nested blocks, should a brief ever have them, need this function to read below the top level.
- An `@` prefix in the bar (VS Code's `@` in Quick Open) is not built.
