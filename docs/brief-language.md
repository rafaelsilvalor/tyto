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

`E_UNKNOWN_SLOT`, `E_UNKNOWN_DIRECTIVE`, `E_MISSING_REQUIRED_SLOT`, `E_BAD_ADJUSTMENT`, `E_ASSET_NOT_FOUND`, `W_TEXT_OVERFLOW` (from compile), `W_UNUSED_SLOT`. All carry a `range` for the editor. Messages are English; the editor may localize them later via the code.

## AST

```ts
BriefAst  { frontmatter: Record<string, unknown>; directives: Directive[]; range }
Directive { name; namespace?; adjustments: Adjustment[]; body: RichText; range }
RichText  = Inline[]; Inline = Text | Bold{children} | Italic{children} | Break | Mark{key, value, children}
```
