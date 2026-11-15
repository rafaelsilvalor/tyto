# 0203 — A template sees the adjustments of every artwork in the brief

Status: accepted · 2026-11-15 · TYTO-679 · extends ADR 0022 (adjustments) and ADR 0048 (an
installed template runs in its plugin's process)

## Context

A template's `build` runs once per (artwork, format) and reads its own context: this
artwork's slots, this artwork's adjustments, and `artwork: { id, index, count }`. Nothing in it
says what the other artworks are.

That is enough until a slide's role depends on the slide before it. In
`tyto-template-questao-estrategica` v0.8.0, measured on 2026-11-11 with `compileTemplate`:

- `::lamina {resposta}` then `::lamina {resposta, continua}` → the second slide is the
  explanation (correct);
- `::lamina {resposta}` then `::lamina {continua}` → the second slide is the **statement**,
  with no diagnostic.

`{continua}` on the statement already works, so the short form is what a person writes after
an answer too, and it silently draws the wrong layout. The template cannot fix it: from its
own flags a bare `{continua}` is indistinguishable after a statement and after an answer.

## Decision

`TemplateContext` gains **`artworks`**: every artwork of the brief, in the order the brief
wrote them, each as `{ adjustments }`, flattened the way `context.adjustments` is.

- **Aligned with `artwork.index`.** `artworks[context.artwork.index]` is this artwork, and its
  `adjustments` equal `context.adjustments`. `compile` sets it on every call, with one entry
  when the manifest has no repeatable slot.
- **Every artwork, not just the previous one.** A chain — `{resposta}`, `{continua}`,
  `{continua}` — has to resolve the third slide by walking back past the second, whose own
  flags say nothing either. A field holding only the previous slide cannot answer that without
  the template re-deriving the role of every slide before, which it has no data for.
- **Adjustments only, never slots or content.** A frame draws its own content; a template
  must not read another slide's text, image or values through this. The entry is an object
  (`ArtworkSummary`) so a later need adds a field rather than changing what `artworks` holds,
  and that later field is a decision of its own.
- **Optional on the type.** Contexts built by hand — tests here and in every template's own
  repository — keep compiling; a template that reads it treats `undefined` as "only this
  slide is known".
- **It crosses to a plugin's process** (ADR 0048) as data, with the call. The host's
  `templateCallSchema` declares it, each entry a strict object holding `adjustments` alone,
  so a call carrying anything else per entry is refused (`E_PLUGIN_CALL`) before the template
  runs.

## Consequences

- `questao-estrategica`'s `roleOf` can make a bare `{continua}` take the role of the nearest
  slide before it that has one. That change lives in the template's repository and needs a
  published `@tyto/core` and `@tyto/plugin-api` carrying this field.
- A template can now behave differently depending on other slides' flags. That is the point,
  and it is limited to flags the manifest declared, which the brief author wrote and the
  editor validates.
- The alternative, a warning when `{continua}` follows an answer without `resposta`, needed
  the same whole-brief visibility and would still have left the short form wrong.
