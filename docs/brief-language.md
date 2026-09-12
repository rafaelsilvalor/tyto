# Brief language (`.brief`)

`::` directives + free text with inline Markdown, optional YAML frontmatter. Lezer grammar in `packages/brief-lang/src/brief.grammar`.

Slot names and enum values are defined by each template's manifest, so they may be in the author's language (Portuguese in the built-in templates). Keywords of the language itself (`template`, `formats`) are English.

```brief
---
template: promo-curso
formats: [feed, story]
cor: azul-escuro
imagem: ./prof-ana.png
---
::titulo Direito **Constitucional**
::subtitulo Aulas ao vivo toda semana

::slide
  O que cai na prova
::slide {destaque}
  Como estudar
::slide {destaque, cor: laranja}
  Garanta sua vaga
```

## Rules

- **Frontmatter**: metadata and scalar slots. `template` is required (or `--template` on the CLI). `formats` defaults come from the manifest.
- **Slot directive** `::name value` — inline value to end of line, or an indented block on the following lines. The name must exist in the template manifest (`E_UNKNOWN_SLOT`).
- **Repeatable directive** (`::slide`) — each occurrence becomes an `Artwork`. The manifest declares which slot is `repeat`.
- **Adjustments** `{a, b: value}` — only those declared in `manifest.adjustments`. They apply to the slot; on a repeatable slot, to that slide.
- **Text**: inline Markdown only — `**bold**`, `*italic*`, `\` line break, `{cor:x}text{/}` mark. No headings, lists or links.
- **Assets**: paths relative to the `.brief` file; `resolve` confirms existence and computes a hash.
- **Comments**: `//` at line start.
- **Escape**: `\::` for text starting with `::`.
- **Plugin directives**: plugins register namespaced directives, `::ai/caption`. Without the plugin ⇒ `E_UNKNOWN_DIRECTIVE`.

## What the grammar settles

`packages/brief-lang/src/brief.grammar` is the definition; `pnpm --filter @tyto/brief-lang
generate:parser` builds it, and the generated parser is build output rather than something
committed. These are the questions the prose above left open, answered where the grammar
had to answer them.

- **Emphasis nests, but never inside its own kind.** Bold may hold italic and italic may
  hold bold, so `**a *b* c**` and `*a **b** c*` both parse; neither may hold itself.
  `*a*b*c*` is ambiguous in Markdown proper — is the second star closing the first or
  opening a nested one? — and Markdown resolves it with delimiter runs, which an LR parser
  cannot do (ADR 0015).
- **Two closers cannot touch.** `**bold *italic***` does not parse: longest match reads the
  trailing `***` as `**` then `*`, leaving both runs open. Write `**bold *italic* **` or
  reorder so text separates the closers. The error lands at the end of the line, repeated
  once per open run — the editor collapses it before showing a squiggle.
- **The first `{…}` after a directive name is an adjustment list.** A mark opens the same
  way, so `::titulo {cor:azul}oi{/}` reads `{cor:azul}` as an adjustment. Put text before
  the mark, or put it in an indented body, where a mark may lead the line.
- **No space before the colon**: `{cor: laranja}`, never `{cor : laranja}`. One token of
  lookahead cannot see past a space to tell `:` from `}`.
- **A blank line ends an indented block.** An indented line is recognised by the break in
  front of it, and a blank line puts a break there instead of an indent.
- **Frontmatter is taken whole and its YAML is left alone.** The grammar marks the block
  from `---` to `---`; a real YAML parser reads it in `parseBrief`. A grammar that tried
  would be a second, worse YAML. Without a closing fence there is no frontmatter, and every
  line of the block is reported.
- **`{` in prose has to be part of a mark.** A literal brace in body text is an error.
  `\::` is the only escape the language has, which is the only one the spec asks for; a
  general one is a change to the spec, not to the grammar alone.
- **A file whose last line has no break still parses.** The tokenizer supplies a zero-length
  one at end of input rather than leaving an error node on a perfectly good brief.
- **`Namespace` includes its slash** (`ai/`), and the space between a directive name and
  its inline body sits inside `InlineBody`. Both are shapes the tokenizer forced, and
  `parseBrief` trims them; the ranges stay exact either way.
- **Recovery keeps going.** A broken directive leaves an error node where the missing token
  belonged and the directives after it still parse, so the editor keeps highlighting a
  half-typed brief.

## Diagnostics

`E_SYNTAX` (from parse); `E_NO_TEMPLATE`, `E_UNKNOWN_TEMPLATE`, `E_UNKNOWN_FORMAT`, `E_UNKNOWN_SLOT`, `E_UNKNOWN_DIRECTIVE`, `E_MISSING_REQUIRED_SLOT`, `E_BAD_SLOT_VALUE`, `E_BAD_ADJUSTMENT`, `E_ASSET_NOT_FOUND`, `W_UNUSED_SLOT` (from resolve); `W_TEXT_OVERFLOW` (from compile). All carry a `range` for the editor. Messages are English; the editor may localize them later via the code.

## AST

```ts
BriefAst   { frontmatter: Record<string, unknown>; directives: Directive[]; range }
Directive  { name; namespace?; adjustments: Adjustment[]; body: RichText; range; nameRange }
Adjustment { name; value?; range }
RichText   = Inline[]; Inline = Text{value} | Bold{children} | Italic{children} | Break | Mark{key, value, children}
```

`parseBrief` in `packages/brief-lang/src/parse-brief.ts` builds it, returning
`Result<BriefAst, Diagnostic[]>`: a brief that does not parse comes back as `Err`, never
as a half-built AST.

**The types live in `@tyto/core`** (`packages/core/src/brief/ast.ts`), for the same reason
`Scene` does — the package that produces a vocabulary type is not the package that owns it.
`resolve` consumes a `BriefAst` and `docs/architecture.md` puts `resolve` in `core`, which
with `brief-lang` depending on `core` leaves nowhere else for them to be. `brief-lang`
re-exports them, so a caller that only talks to the parser has one import.

`frontmatter` is a `Frontmatter`, not a bare record: `data` is what the YAML said, `ranges`
is the span of each top-level key, and `range` is the whole block. The ranges are what let
`resolve` underline the key that named an unknown slot instead of the block around it.

## What the AST settles

The tree is a syntax tree and the AST is a meaning tree, so the conversion is not a
rename. These are the choices that gap forced, and where each one shows.

- **The shapes the tokenizer needed are gone.** `Namespace` loses its slash, the space
  between a directive name and its inline body is dropped, and the `Space` nodes that
  exist only because a `Text` token may not begin with one are merged back into the text
  around them. Ranges stay exact through all three.
- **A `Text` node carries what the source meant, not what it says.** `\::` arrives as
  `::`, so its `value` is two characters where its `range` covers three. That is the only
  place the two lengths differ, and it is what an escape is for.
- **The line between two block lines is a `Break`** — the same node a trailing `\`
  produces. The author wrote three lines and means three lines, the language has no other
  way to say so, and concatenating them would glue two words together. No break is emitted
  before the first line of a block, where the boundary separates the body from the
  directive name rather than one line of text from the next. One `Break` serves both,
  rather than a soft and a hard kind, because nothing downstream would tell them apart:
  the overflow strategies are `clip`, `shrink` and `grow`, all of which change size, and
  none of which reflows by collapsing a break. A `Break` lands in the IR as its own
  `TextRun` (ADR 0016); `compile` writes that mapping.
- **A directive's range stops before the line break that ends it.** The break is
  punctuation; an editor squiggle that ran onto the next line would be pointing at it.
- **A directive is ranged twice: the whole of it, and its name.** `range` covers `::` to
  the end of the body, which is the span a problem with the _value_ belongs to. A problem
  with the _name_ — an unknown slot, a directive no plugin claims — belongs to `nameRange`,
  five characters rather than five lines. It takes in the namespace and its slash, so
  `::ai/caption` underlines `ai/caption`, and leaves out the `::`: that is the only way to
  write a directive, so it is never the part that is wrong.
- **One diagnostic per position.** Two touching closers leave four error nodes at the same
  offset, one per open run recovery had to close — one mistake, so the first at each
  position wins and the other three are dropped.
- **An empty error node is read from the construct around it.** Lezer recovers by
  inserting the missing token, which records where but not what; the enclosing node is the
  what, so an empty error inside `Bold` reports a missing closing `**`.
- **Comments and blank lines are dropped.** They are how a brief is written, not what it
  says, and nothing downstream renders them.
- **The frontmatter is parsed but not judged.** `parseBrief` reports YAML that does not
  parse and a block that is not a mapping; a missing `template` or a `formats` of the
  wrong type is `resolve`'s diagnostic to raise, because this stage knows the language and
  not the templates.

## What resolve settles

`resolve(ast, { registry, assets, template?, renderedSlots? })` in
`packages/core/src/brief/resolve.ts` is where a brief meets the template it was written
for. It answers what neither neighbour can: the parser knows the language and nothing about
templates, the compiler knows a template and nothing about the brief that fed it.

- **Two questions stop everything else.** A brief that names no template, or one the
  registry does not have, comes back with that diagnostic alone: without a manifest there
  is nothing to check a slot against. Every other problem is reported in one pass.
- **The frontmatter and a `::directive` are the same thing by the time the manifest is
  asked.** They differ in where the value came from and in nothing else, so a scalar in the
  frontmatter reaches a rich-text slot as one run of text spanning its key. The repeatable
  slot is the exception: it is written with a directive, because each occurrence is an
  artwork and a mapping key appears once.
- **`W_UNUSED_SLOT` needs the template body, so it is opt-in.** A manifest says which slots
  _may_ be set; only the template says which are _drawn_, and reading a template is
  `compile`'s job. A caller that has already parsed one passes `renderedSlots` and gets the
  warning; a caller that has not gets silence rather than a guess.
- **A defaulted slot has no range**, because the brief never wrote it. Every other resolved
  slot carries the span of the directive or the frontmatter key that set it.
- **A name diagnostic lands on the name.** `E_UNKNOWN_SLOT` and `E_UNKNOWN_DIRECTIVE` are
  reported against the directive's `nameRange`; every other diagnostic keeps the span of
  the whole directive, because every other one is about the value. A frontmatter key is its
  own name, so that half was already right.
- **`E_UNKNOWN_SLOT` suggests.** A declared name within an edit distance of a third of the
  written word is a typo and becomes a hint; anything further is a different slot, and
  suggesting it would be worse than suggesting nothing.
