# 0227 — Shared and slide blocks add up, and a named shared block is placed by name

Status: accepted · 2026-11-22 · TYTO-838 · supersedes decision 4 and amends decisions 1 and 6
of ADR 0225

## Context

ADR 0225 let a slide's slot be shared or a slide's own, and gave a slide's own value precedence:
written both before the slides and inside slide 2, slide 2 drew only its own. A shared block
could sit only above every slide's own blocks (written before the first slide) or below them
(after `::comum`), and `shared` beside `multiple` was refused, so a brief held one shared block
of a kind.

On 2026-11-22 the maintainer set two needs. Write once what repeats and inside a slide only
what changes, **the two adding up**: a title shared by every artwork plus a status line only
one of them carries. And several blocks of one kind, each with its own weight (`{peso}`), such
as the vacancies and the salary of an exam as two `::corpo`. He then asked how a shared block is
put _between_ two of a slide's own blocks, and approved names for that, with this brief:

```
::corpo {nome: vagas}
  ### **146 vagas**
::corpo {nome: salario, peso: 4}
  ## Até R$ 24 mil
::lamina
::corpo {nome: vagas}
::apelo
  Último Lote | # 30% OFF
::corpo {nome: salario}
```

**What existed at `origin/main` 90cc2ad, read in the code.** `resolve` kept a shared slot
written inside a slide in that artwork's `slots`; `compile`'s `orderOf` left a shared slot out
of the shared groups when the slide had one of that name; `PlacedSlot` was `{ name, place }`
with no content, so a template could not tell two blocks of one name apart; `manifest.ts`
refused `shared` with `multiple`; an adjustment had to be declared by the manifest.

## Decision

1. **A slide's own block adds to the shared ones; it no longer replaces them** (supersedes ADR
   0225 decision 4). On each artwork every shared block and every own block is drawn.
   `context.slots` is unchanged — under a name it still holds the slide's own value when there
   is one, so a template that reads one value per slot reads what it read.
2. **`shared` may stand beside `multiple`** (amends ADR 0225 decision 1): a brief may write
   several shared blocks of that slot, before the slides or after `::comum`, each with its own
   adjustments. The manifest's `max` counts them as it counts a slide's own. `ResolvedBrief.slots`
   holds the first, with every one in `occurrences`, as a slide's own list already does
   (ADR 0207).
3. **`{nome: …}` is reserved: it names a shared block.** Every slot directive may carry it
   without the manifest declaring it; a manifest that declares an adjustment `nome` is refused.
   The name is letters, digits, `-` or `_`. On a slot that is not `shared` it is
   `E_BAD_BLOCK_NAME` at the adjustment. Two shared blocks of one slot with the same name are
   `E_BAD_BLOCK_NAME` at the second.
4. **An empty directive of a shared slot inside a slide is an anchor**: the shared block is
   drawn there on that slide, in the brief's order, and is not drawn again above or below. With
   `{nome: x}` it places the shared block named `x`; without a name, the first shared block of
   that slot this slide has not placed yet, in written order. Empty means no text; an anchor
   takes no adjustment but `nome` (a weight goes on the shared block). An anchor naming no
   shared block, one with no shared block left to place, or one placing a block a second time
   on a slide is `E_BAD_BLOCK_NAME` at its line — an error, not a warning, since the artwork
   would otherwise lose the block in silence. Names are checked once the whole brief is read,
   so an anchor may name a block written after `::comum`.
5. **A shared block a slide does not anchor keeps ADR 0225's place**: before the slide's own
   blocks when written before the first slide, after them when written after `::comum`.
6. **`context.order` carries each block's value** (amends ADR 0225 decision 6):
   `{ name, place, slot }`, where `place` gains `'anchored'` and `slot` is the `ResolvedSlot`
   drawn there, with its adjustments — so two `corpo` are two entries a template reads apart.
   Each occurrence of a `multiple` slot is its own entry. `slot` is optional in the type, as
   `order` is, because a context built by hand has none; `compile` always sets it. It crosses
   to a plugin's process through `templateCallSchema`, which now accepts the value.

## Consequences

- A brief that wrote a block both shared and inside a slide now draws both on that slide. No
  brief in the maintainer's test folders does (the anuncio skill v22 says to write each block
  in one place until this lands); a template that keys its layout by slot name sees the name
  twice in `order` and must read `slot` to draw both.
- Templates gain nothing by themselves: the kit's block column (TYTO-839) and anuncio
  (TYTO-840) read `order` entry by entry.
- No protocol bump, as with ADR 0225: the call's schema is the host's own guest bootstrap's.
- The editor does not offer `nome` after `{`; it is left open.
