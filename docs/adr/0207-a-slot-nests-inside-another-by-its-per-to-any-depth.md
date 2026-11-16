# 0207 — A slot nests inside another by its `per`, to any depth

Status: accepted · 2026-11-16 · TYTO-709 · decides what ADR 0202 decision 3 left open · extends
ADR 0160 (`per`) and ADR 0096 (Format Brief) · answers ADR 0095's consequence on nested blocks

## Context

ADR 0202 made indentation visual and put nesting in the manifest: "a slot declares its parent,
generalising `per`, to any depth; a directive belongs to the nearest open occurrence of its
parent above it", and with that an indented `::` becomes a directive. It left two questions to
this card: whether the key is `per:` extended or a new `parent:`, and how a template receives the
tree if `context.slots` stops being flat.

**What existed at `origin/main` 73070bb, read in the code.** `per` had to name the manifest's
repeatable slot (`manifest.ts`, the refinement over `slots`). `resolve` attached a `per` value to
the last occurrence (`ownerOf`), into `ResolvedArtwork.slots`, and `compile` merged those over
the brief's slots, so `context.slots.imagem` was this slide's picture. An isolated template
received `slots` through `templateCallSchema` as `z.record(z.string(), z.unknown())`. An
indented `::` line was body text: `::lamina` / `  Linha um` / `  ::imagem ./a.png` was one
lamina whose body ended in `::imagem ./a.png`; ADR 0202 counted 0 of 405 `.brief` files on the
maintainer's machine with one.

Paragraphs are not this card's: a blank line between two lines of text is one (ADR 0205).

## Decision

1. **`per` is extended; there is no `parent:`.** `per` may name the repeatable slot, as before,
   or another slot that declares `per`, to any depth: `bloco: { per: lamina }`,
   `paragrafo: { per: bloco }`. The chain must end at the repeatable slot, so every nested value
   belongs to a slide. A name that neither repeats nor declares `per`, or a cycle, is a manifest
   error at `slots.<name>.per`. One key keeps one rule — "belongs to" — and every manifest
   written for ADR 0160 means what it meant.
2. **A directive belongs to the nearest open occurrence of the slot its `per` names.**
   `resolve` keeps the open occurrences as a stack, outermost first: a slide opens a new one;
   a `per` slot finds the nearest entry of its parent, closes everything opened inside that
   entry since, attaches to it and opens itself. A brief-wide slot (no `per`) changes nothing,
   wherever it is written. So `::lamina` / `::bloco` / `::nota` (per lamina) / `::paragrafo`
   (per bloco) has no `bloco` open for the paragraph: the slide's own `nota` closed it.
3. **The errors are the ones `per` already had.** With no occurrence of its parent open, a
   directive is `E_BAD_SLOT_VALUE` at its own line ("no 'bloco' is open above it"). A second
   one inside the same parent is "set more than once", as ADR 0160 rule 2 says for a slide. A
   `required` slot is required inside every occurrence of its parent: `E_MISSING_REQUIRED_SLOT`
   at that parent's line, and the slide holding it is the one whose frames carry the gap stamp
   (ADR 0035). With no parent written, nothing is missing.
4. **The template receives the tree with no protocol bump.** A slide's own slots stay flat in
   `context.slots`, exactly where ADR 0160 put them, so every installed template reads what it
   read. From the second level down, a value rides inside its parent: `ResolvedSlot` gains an
   optional `slots`, present only when something was written inside it —
   `context.slots.bloco.slots.paragrafo`. `slots` crosses to an isolated template as the loose
   record it always was; a test in `isolated-plugin.test.ts` fails if `templateCallSchema`
   drops the nested field (the TYTO-679 pattern for an optional field).
5. **An indented `::` is a directive, at any indent** (ADR 0202 decision 3). The grammar stays a
   flat list of directives: `directiveIndent`, from `nestedDirectives` in `tokens.ts`, is the
   line break, blank lines and indent in front of the `::`, and ends the directive above as
   `newline` does. At the start of a line with no break in front — the file's first line, or
   the one after the frontmatter — it is the indent alone, read as a blank line. A literal `::`
   at the start of a body line is `\::`, the escape the language already had. An indented `//`
   stays a comment of the block it is in (ADR 0204), and a column-0 `//` followed by an
   indented `::` is a top-level comment, since that `::` does not continue the block
   (`blockGoesOn`). A brief-wide slot written indented under a slide, `  ::titulo X`, is the same
   `::titulo X` it is at column 0.
6. **`multiple` stays on the slide's own slots.** It keeps ADR 0160's amended meaning — several
   pictures among the slide's lines — and is a manifest error on a slot whose `per` names
   anything but the repeatable slot. Several `::bloco` in one slide wait for a template that
   needs them.
7. **Format Brief and the editor draw the tree from the manifest.** `formatBrief` takes an
   optional `depthOf` (`slotDepth` over the manifest, exported by core): each directive is
   indented by its depth and its body and comment lines one level more. Without it every
   directive goes to column 0, which is the shape a brief whose template is unknown always had.
   The editor passes the manifest of the brief's last analysis. `briefBlocks` gives a block its
   `depth` and the index of its `parent`, by rule 2; the breadcrumb names the chain
   (`::lamina 2 › ::bloco › ::paragrafo`) and "Go to Block" indents a nested label one em space
   per level. A new brief's skeleton writes a required slot under its required parent, a level
   deeper. A block's range and its fold stay its own lines.

## Consequences

- The one change of meaning: an indented `::` that used to be text is now a directive, and
  usually `E_UNKNOWN_SLOT`. The changeset says so; `\::` keeps it text.
- Format Brief now moves a slide's own `per` slots one level in (`  ::imagem ./a.png`) on a
  template that declares them, and, for a `multiple` picture, the lines under it one level
  further. Nothing in the Scene changes; the shape on screen does, once, on the next format.
- `template.html` templates read `slots` through `@each` and named slots; reading a nested
  value from HTML is not built, as ADR 0160 left `blocks` unread there.
- No production template nests yet; the fixture is a test template (ADR 0151). The first that
  does writes its manifest with `per` chains and reads `slots.<parent>.slots`.
