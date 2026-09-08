# 0017 — A template's vocabulary is spelled in classes, and branched on with `@if`

Status: accepted · 2026-09-07 · extends the markup path of ADR 0005

## Context

ADR 0005 chose an HTML-like `template.html` beside `template.ts`, both producing `Scene`.
TYTO-24 wrote the parser, and the card named three contradictions inside
`docs/template-authoring.md` that had to be settled first — `content: slot(…)` using a
property the doc's own list forbids, `bg` and `format` missing from the attribute list, and
what `@each <slot>` means now that `compile` iterates artworks. All three are recorded in
the doc; none of them needed an ADR, because each had exactly one coherent answer.

Two more decisions did not. Both are about the same hole, and neither is a contradiction in
the doc — they are things the doc never said, and the parser cannot be written without
them.

**A brief speaks the template's vocabulary, and only the template knows what the words
mean.** `docs/brief-language.md` lets a brief write `{cor: laranja}` as an adjustment and
`{cor:laranja}…{/}` as a mark inside rich text. `laranja` is not a colour; it is a word this
template chose. The TS path has an obvious place to translate it — `runsOf(text, style, {
mark: (key, value) => … })` takes a callback, and `compile.test.ts`'s fixture maps `laranja`
to `#ff5900` through a `PALETTE` object in the template's own code. Markup has no callbacks.

The doc says what an adjustment becomes and stops there: _"Adjustments become classes:
`{destaque}` ⇒ `.destaque` targetable from CSS; `{cor: laranja}` ⇒ `--slot-cor: laranja`."_
So an enum arrives as a variable holding the word `laranja`, and there is no operation in
CSS — `var()` included — that turns a word into `#ff5900`. Written as specified, an enum slot
can be read and never used. The same hole swallows marks: a mark arrives as structure in the
rich text and has nowhere to pick up a colour.

Both halves need a place where a template writes down what its own words mean.

## Decision

**A mark takes the run properties of the class that spells it out.** `{cor:laranja}Turma
nova{/}` in a brief reads the rule `.cor-laranja`, and `color`, `font`, `font-size` and
`font-weight` from it land on those runs. A mark nothing spells out passes its children
through unchanged, which is the behaviour `runsOf` already has for an unmapped mark.

The class is the same vocabulary spelled the same way, which is the point: `cor` and
`laranja` are the two names the brief author already typed, and `.cor-laranja` is the
concatenation. The alternatives were a mark-only namespace (`.mark-cor-laranja`, longer and
teaching a second convention) and a dedicated at-rule (`@mark cor laranja { … }`, a third
at-rule to hold what a class already holds).

**`@if slot(<name>) is <value>`, beside the specified `@if slot(<name>) is empty`.** The
block applies while the enum `<name>` holds `<value>`, where an adjustment on this artwork
wins over a slot of the same name. `empty` is the value that means "the brief set none". One
rule with two readings of `is`, so:

```css
:root {
  --bg: #0c2340;
}
@if slot(cor) is laranja {
  :root {
    --bg: #ff5900;
  }
}
```

This is what makes an enum reach a value at all, and it is why custom properties are read
only from `:root`: one document-level variable scope, recomputed once per (artwork, format),
is a thing an author can hold in their head, and a `:root` nested in a conditional block is
enough to vary it. A variable whose value depended on which element was asking would be a
second cascade, and the IR has no inheritance to hang one off.

**The two namespaces stay separate, and that is deliberate.** A flag adjustment becomes an
ambient class — `{destaque}` is on every element of that artwork, so a rule that wants it
writes `.slide.destaque`. An enum becomes `--slot-<name>` and a `@if` branch, never a class.
Were an enum also to become the class `.cor-laranja`, that one rule would do two jobs — the
artwork's colour and the mark's colour — and an artwork carrying `{cor: laranja}` would paint
`color` on every node in it. The mark keeps the class; the artwork keeps the variable.

**`@each <slot>` is a scope, not a loop** — recorded here as well as in the doc, because it
is the third piece of the same model. `compile` calls the template once per (artwork, format)
with the repeatable slot already resolved to this artwork's occurrence, so there is nothing
to iterate. The block applies while rendering an artwork that slot produced.

## Consequences

A template's palette lives in one place — `:root` plus a `@if` per value — and its marks live
beside it as classes with the same names. A designer reading the stylesheet sees the whole
vocabulary in the same file as the layout, which is what ADR 0005 wanted from an HTML-like
format in the first place.

`@if` now has two readings, so its diagnostic has to name both:
`"@if reads as '@if slot(<name>) is empty' or '@if slot(<name>) is <value>'"`. The prelude is
validated when the template is compiled, not when it is built, so a misspelled slot in an
`@if` is reported by `tyto template check` without a brief.

The markup path cannot compose text the brief did not write. A slide that numbers itself
`2/3` is arithmetic on `context.artwork`, and this path draws slots — that template is a
`template.ts`. The doc already sent computation there; TYTO-24 made it a stated limit rather
than an implication, and the acceptance test's TS twin omits the counter for the same reason.

The cost of being wrong is a parser change and a doc change, with no scene, exporter or brief
affected: both decisions are about how a stylesheet is read, and nothing downstream of
`Scene` can tell. That asymmetry is why they ship with the parser instead of waiting for the
first real template (E4.4), which is the thing that will actually exercise them.
