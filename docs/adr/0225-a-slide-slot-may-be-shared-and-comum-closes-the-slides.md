# 0225 — A slide's slot may be shared, and `::comum` closes the slides

Status: accepted · 2026-11-21 · TYTO-823 · extends ADR 0160 (`per`) and ADR 0207 (nesting) ·
builds on ADR 0203 (what a slide reads of the brief)

## Context

A slot is either the brief's (no `per`, set once, the same on every artwork) or a slide's own
(`per: lamina`, one per slide, ADR 0160). A note that is the same on most slides and different
on one had to be written on every slide, or declared twice under two names.

On 2026-11-21 the maintainer set the rule that decides it: **what lives outside a `::lamina` is
the same on every artwork; what lives inside one varies per artwork.** Read top to bottom, as
the art is read, that rule leaves one case open. A block written after the last slide is inside
that slide by position — ADR 0160 gives it to the slide written last before it — and could just
as well be meant for every slide, drawn below each one's own blocks. Both readings are useful,
and the brief had no way to say which.

**What existed at `origin/main` 94b7fa44, read in the code.** `resolve` put a `per` slot into
the last occurrence's `ResolvedArtwork.slots` and refused one before any slide or in the
frontmatter; `compile` built each artwork's slots as `{ ...resolved.slots, ...artwork.slots }`,
so a slide's own value already wins over a brief-wide one of the same name. A template had no
way to know in what order the brief wrote its blocks: `context.slots` is a record. A grep of the
maintainer's templates found no slot named `comum`.

## Decision

1. **A slot may declare `per: <the repeatable slot>` and `shared: true`** — shared or a slide's
   own. Only when `per` names the repeatable slot directly: on a nested `per` (a block inside a
   slide, which no artwork shares) or without `per` (shared already) it is a manifest error at
   `slots.<name>.shared`, and so is `shared` beside `multiple`, since a shared value has no
   slide to count it in. The field is optional with no default, so a manifest that never says
   it parses to the object it did. A `per` slot still takes no `default`.
2. **Where it is written decides what it is.** Before the first `::lamina`, or in the
   frontmatter, it is the brief's, placed _before_ the slides' own blocks. After a `::lamina`
   it is that slide's own — the last slide included — exactly as a `per` slot always was.
3. **`::comum` closes the slides.** It is a directive line with no body and no adjustments;
   either one is `E_BAD_COMUM` at its own range, and the line still closes the slides. After it
   a `shared` slot is the brief's, placed _after_ every slide's own blocks; a plain `per` slot
   or a new `::lamina` is `E_BAD_SLOT_VALUE` at its line, saying `::comum` closes the slides.
   `::comum` in a template with no repeatable slot, before the first slide, or a second time is
   `E_BAD_COMUM` at its name and closes nothing, so the rest of the brief reads as written. The
   name is reserved: a manifest that declares a slot `comum` is refused. The grammar is
   unchanged — `::comum` parses as any directive and only `resolve` knows it.
4. **A slide's own replaces the shared one for that artwork only.** `compile`'s merge already
   gives the slide's value precedence; the other artworks keep the shared one. A shared value
   written twice — before the slides and after `::comum`, say — is "set more than once", as any
   brief-wide slot is. A `required` shared slot is missing only on a slide that has neither its
   own value nor a shared one.
5. **A slot without `per` keeps its meaning wherever it is written** — shared. For order it is
   placed _before_ when written before the first slide and _after_ otherwise.
6. **The order reaches the template as `context.order`**: this artwork's blocks in drawing
   order, `{ name, place: 'before' | 'own' | 'after' }` — the shared slots written before the
   first slide by position, then the slide's own (its slots directly under the slide, by
   position; not the repeatable slot itself, nor anything nested deeper), then the shared slots
   placed after, by position. A shared slot the slide replaced is listed once, as `own`. A slot
   with no source range (a manifest or configuration default) is not listed. Optional like
   `artworks` (a context built by hand has none); `compile` always sets it, one artwork's worth
   when nothing repeats. It crosses to a template in a plugin's process through the strict
   `templateCallSchema`, which accepts names and places only — no content.
7. **The editor offers `comum`** after `::` only for a template with a repeatable slot, and the
   slot list says `shared` beside `per lamina`. A shared enum is offered its values as a
   frontmatter key, where it may now be written.

## Consequences

- A note the same on every slide but one is written once before the slides and once inside
  that slide; a closing line under every slide is written once after `::comum`.
- `order` is computed in `compile` from the source ranges `resolve` keeps; `ResolvedBrief` does
  not change shape. What is shared and written after a slide is either after `::comum` or a
  slot without `per`, because `resolve` keeps every other `shared` value as the slide's own.
- No protocol bump, the same arrangement as `artworks` (ADR 0203): the call field is optional,
  and a template in its own repository reads it once a published `@tyto/core` and
  `@tyto/plugin-api` carry it. Whether a guest built against an older `@tyto/plugin-api`
  accepts a call carrying `order` was not measured.
- Format Brief and the editor's block list still nest a `shared` slot by its `per` alone, so
  one written before the first slide or after `::comum` is indented one level, as a slide's own.
  The indent is visual (ADR 0202), so the Scene does not change; it is left open.
