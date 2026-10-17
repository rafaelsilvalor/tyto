# 0098 — The breadcrumb names the block at the cursor, not the file

Status: accepted · 2026-10-17 · TYTO-273 · fills the slot of ADR 0085 decision 2 · consumes the
list of ADR 0095

## Context

ADR 0085 gave every editor group a discreet header row under its tab strip — 22 px, the
editor's background, no line, small muted text — holding one empty slot, `[data-breadcrumb]`,
for this card. VS Code's breadcrumb there reads `folder › file › symbol`: where the file is and
where the caret is inside it.

A brief is long and its blocks look alike: three `::lamina` in a row differ by their text only.
The status bar says `Ln 40, Col 3`, which says nothing about which slide that is. The tab above
the row already names the file, and its tooltip names the folder (ADR 0086).

ADR 0095 made the brief's blocks one pure list read off the Lezer tree — the frontmatter and
every top-level directive, with an ordinal only for a slot the manifest says repeats — and
remembered it per tree so that a caret move costs a lookup. "Go to Block" (TYTO-296) shows it.

## Decision

**1. The breadcrumb names the block the caret is in, and not the file.** The tab names the file,
so the row says only what the tab cannot: `::lamina 2`, `::titulo`, `::ai/caption`, or
`cabeçalho › template` / `header › template` in the frontmatter. No file name, no folder.

**2. It consumes ADR 0095's list and walks nothing of its own.** `breadcrumbAt(blocks, pos,
slice)` and `breadcrumbOf(state)` in `packages/editor/src/breadcrumb.ts` read `blocksOf` and
`blockAt`. A directive's label is `directiveLabel`, which "Go to Block" uses too, so the two can
never name a block differently: the namespace kept, an ordinal only where the list has one.

**3. In the frontmatter, the key on or above the caret's line.** A key is a line starting at
column 0 with a name and a `:`; a list item or continuation under it keeps the key above. On the
opening fence there is none and the row says the frontmatter alone. The frontmatter's word is
the window's (`breadcrumb.frontmatter`), since `@tyto/editor` owns no words (ADR 0095 decision 6);
the editor answers `{ kind: 'frontmatter', key? }`.

**4. Where a block is, is where its fold and "Go to Block" say it is.** A blank line between two
text lines of a block is inside it (ADR 0087); a blank line after its last text line, a line
between blocks and a comment are in none, and the row is empty.

**5. Each group shows its own caret**, as VS Code does: a follower pane's selection is its own
(ADR 0083), and so is its breadcrumb. Written in the same `onUpdate` that paints the status bar,
for the group whose pane the transaction came from, and for every group on a repaint (a tab
switch, a preview in front, a language change) — only when the text changed.

**6. Only a brief has one.** A settings, keybindings or snippets tab (JSON), a preview in front
and template mode — which has its own editors and no groups — show an empty row.

**7. Plain text, muted, silent.** The parts are text joined by `›`, not links or buttons; the
row's `--tyto-text-muted` is the colour (ADR 0085), and the slot's ellipsis is what gives way in
a narrow group. No `aria-live`: a caret move announcing a block on every arrow key would talk
over the screen reader's own reading of the line.

## Consequences

- No new IPC channel, setting or theme token; the token count stays 42.
- Clicking a part to pick a sibling block — VS Code's breadcrumb picker — is not built; it would
  be a card of its own, and "Go to Block" (`Mod-Shift-o`) is the list today.
- Nested blocks, should a brief ever have them, would make the breadcrumb longer than one part
  with no change here beyond ADR 0095's list reading below the top level.
- A hidden header row (a preview in front) still holds an empty string; nothing paints it.
