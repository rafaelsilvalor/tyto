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

## Diagnostics

`E_UNKNOWN_SLOT`, `E_UNKNOWN_DIRECTIVE`, `E_MISSING_REQUIRED_SLOT`, `E_BAD_ADJUSTMENT`, `E_ASSET_NOT_FOUND`, `W_TEXT_OVERFLOW` (from compile), `W_UNUSED_SLOT`. All carry a `range` for the editor. Messages are English; the editor may localize them later via the code.

## AST

```ts
BriefAst  { frontmatter: Record<string, unknown>; directives: Directive[]; range }
Directive { name; namespace?; adjustments: Adjustment[]; body: RichText; range }
RichText  = Inline[]; Inline = Text | Bold | Italic | Break | Mark{key, value, children}
```
