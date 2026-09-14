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

- **Frontmatter**: metadata and scalar slots. `template` is required (or `--template` on the CLI). `formats` defaults come from the manifest. A scalar on a rich-text slot is one run of plain text, and inline markup in it is `W_MARKUP_IN_FRONTMATTER` — see below.
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
- **A line ends on `\n`, on `\r\n` or on a lone `\r`.** A brief is a file a person edits, and
  the three endings are all a real editor writes; a Windows file used to fail at the
  frontmatter fence and then report every directive after it as incomplete.
  `.gitattributes` does not solve that, because the parser is handed text by a CLI reading
  a disk and by an editor holding a buffer, and neither goes through Git.
- **The endings are read by the grammar, not normalised away first.** Normalising would move
  every offset by one unit per line, and a `range` indexes the text the caller handed in —
  an editor highlighting a range computed against a shorter string would underline the
  wrong characters. So the three endings are line endings in the tokens themselves, offsets
  stay the caller's, and `createLineIndex` in `core` already counts all three as one line
  end. The one exception is inside the frontmatter, where `yaml` does not recognise a lone
  `\r`: those are rewritten before it parses, which swaps one code unit for one and
  therefore moves nothing.
- **Two places spell the rule, and a check keeps them spelling it the same.** The grammar's
  `lineBreak` token is one; `isLineEnd` and `afterLineEnd` in `tokens.ts` are the other,
  because an external tokenizer scans for the `---` fences by hand and cannot reach a rule
  the grammar compiles away. `tools/repo-checks/src/grammar-line-break.test.ts` translates
  the token and compares, so a fence recognised on one side and not the other fails
  `pnpm check` instead of becoming a brief that half-parses. Same argument, same shape as
  the `identifier` check beside it.
- **`Namespace` includes its slash** (`ai/`), and the space between a directive name and
  its inline body sits inside `InlineBody`. Both are shapes the tokenizer forced, and
  `parseBrief` trims them; the ranges stay exact either way.
- **Recovery keeps going.** A broken directive leaves an error node where the missing token
  belonged and the directives after it still parse, so the editor keeps highlighting a
  half-typed brief.

## Highlighting

`briefHighlighting` in `packages/brief-lang/src/highlight.ts` maps node names to
`@lezer/highlight` tags, and `@tyto/editor` turns tags into colours. It lives with the
grammar so that adding a node to the language and forgetting to colour it is one file's
problem rather than two packages'; the package stays pure, because a tag renders nothing.

Two of Lezer's rules decide how every line of that table is spelled, and **both are silent
when broken** — which is why `highlight.test.ts` reads the spans a renderer would receive
instead of asserting the table back at itself.

- **Only a capitalised rule produces a node.** `directiveMark`, `braceOpen`, `valueSep` and
  the rest are lowercase tokens: real characters in the document with no name in the tree,
  so a rule spelled after one matches nothing and colours nothing. The punctuation of a
  construct is styled through the construct instead — a tag on `Adjustments` paints exactly
  what no child node covers, which is the braces and the commas, and `AdjustmentName` takes
  its own span back.
- **A tag stops at the first child unless it is written `Node/...`.** `Bold: tags.strong`
  bolds the two `**` and leaves the `Text` between them at normal weight. An inherited tag
  also _adds_ to the child's own rather than replacing it, which is what makes `*b*` inside
  `**a *b* c**` both `strong` and `emphasis` — and the reason the adjustment list uses two
  plain rules rather than one `/...`: a name tagged `punctuation attributeName` would leave
  the colour to stylesheet order.

Both mistakes were in the first table, written before an editor existed to render it; TYTO-36
is where they showed.

## Diagnostics

`E_SYNTAX` (from parse); `E_NO_TEMPLATE`, `E_UNKNOWN_TEMPLATE`, `E_UNKNOWN_FORMAT`, `E_UNKNOWN_SLOT`, `E_UNKNOWN_DIRECTIVE`, `E_MISSING_REQUIRED_SLOT`, `E_BAD_SLOT_VALUE`, `E_BAD_ADJUSTMENT`, `E_ASSET_NOT_FOUND`, `W_UNUSED_SLOT` (from resolve); `W_TEXT_OVERFLOW` (from compile). All carry a `range` for the editor. Messages are English; the editor may localize them later via the code.

### What the editor shows, and what it cannot

`@tyto/editor` runs `parse` + `resolve` on a debounce and turns every `Diagnostic` into a
CodeMirror lint marker — same code, same message, same span, because a `SourceRange` is
already the pair of UTF-16 offsets CodeMirror consumes and nothing is converted on the way
in. Two of the codes above never reach the gutter, and both absences are deliberate.

- **`W_TEXT_OVERFLOW` does not, because the editor does not `compile`.** Compiling executes
  a template, which is a third party's code, and it happens when somebody asks for output —
  not on every keystroke over a brief that is halfway written.
- **`E_ASSET_NOT_FOUND` does not, unless the host can see a disk.** The renderer cannot
  (ADR 0010), so the default `BriefAnalyzer` accepts every path. Underlining every image in
  a brief that renders perfectly well from the CLI would teach an author to ignore the
  gutter; a host that has a bridge to a filesystem passes an `AssetResolver` and gets the
  diagnostic back.

**A quick fix is offered only where the text under the diagnostic's range is exactly a
name.** The ranges differ by code and by shape — `E_UNKNOWN_SLOT` lands on a directive's
`nameRange`, `E_BAD_ADJUSTMENT` on the adjustment's own range (a bare name for a flag,
`name: value` for an enum), `E_BAD_SLOT_VALUE` on the whole directive including its body —
and replacing the last with a slot name would delete what the author wrote. The suggestion
itself is `didYouMean` from `core`, the same function and the same budget that produced the
diagnostic's `hint`, so the button and the message can never name different slots.

Completion is driven by the same pass: the manifest the frontmatter named feeds slot names
after `::`, adjustment names inside `{}` filtered by their `applies`, enum values after
`:`, and format ids in the frontmatter list. Changing `template:` swaps every one of those
lists, because none of them is hard-coded — they are the template author's vocabulary, and
the manifest is the only place it is written down.

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
- **Too few occurrences is blamed on the frontmatter.** Falling short of a repeatable
  slot's `min` usually means writing none of it, and nothing in the file marks the slide
  that was never written — so it borrows the span `E_MISSING_REQUIRED_SLOT` falls back to.
  Too _many_ is different: the first occurrence over the limit is right there, and carries
  the diagnostic.
- **A defaulted slot has no range**, because the brief never wrote it. Every other resolved
  slot carries the span of the directive or the frontmatter key that set it.
- **A name diagnostic lands on the name.** `E_UNKNOWN_SLOT` and `E_UNKNOWN_DIRECTIVE` are
  reported against the directive's `nameRange`, and `E_BAD_ADJUSTMENT` against the
  adjustment's own `range` — which is the bare name for a flag (`{destaque}`) and
  `name: value` for an enum, because that is the whole of what the author wrote. Every
  remaining diagnostic keeps the span of the whole directive, because every remaining one is
  about the value. A frontmatter key is its own name, so that half was already right.
- **A frontmatter scalar on a rich-text slot stays plain text, and says so.** A `titulo`
  set in the frontmatter to `Direito **Constitucional**` renders the asterisks; the same
  words after `::titulo` come out bold. The scalar is accepted — a one-line title in the frontmatter is why the
  frontmatter carries scalar slots at all — but inline markup inside one is
  `W_MARKUP_IN_FRONTMATTER`, naming the markup and the directive to write instead. It is a
  warning and not an error because the brief still means something, and it is not parsed
  because `core` may not import `brief-lang`; parsing it would mean moving the inline layer,
  which is a bigger decision than this one (TYTO-59).
- **The markup detector is deliberately crude, and errs quiet.** It is a second reader of
  the inline syntax rather than the parser itself, so it asks for two asterisks before it
  calls something italic, for a `{/}` before it calls something a mark, and for the
  backslash to be last. `Promo 2 * 3 vagas` is not a warning. A detector that cried wolf
  would teach an author to ignore the warning, which costs more than the case it missed.
- **`E_UNKNOWN_SLOT` suggests.** A declared name within an edit distance of a third of the
  written word is a typo and becomes a hint; anything further is a different slot, and
  suggesting it would be worse than suggesting nothing.
