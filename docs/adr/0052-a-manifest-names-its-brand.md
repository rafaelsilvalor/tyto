# 0052 — A manifest names its brand

Status: accepted · 2026-09-28 · TYTO-195 · extends ADR 0020's manifest

## Context

On 2026-09-27 the maintainer asked for templates to be told apart at a glance, and chose to put
identity in the manifest rather than in the template's name: "Campo novo no manifesto". About
150 templates are waiting to be ported, several brands among them; nothing in a manifest said
that `agenda-semana` is Azul's and `promo-curso` a demonstration.

Two of the three facts about a template's identity already had a home by the time this was
built. **What the piece is about** is the template's name. **What kind of piece it is** is
derived from its formats and whether it repeats (ADR 0051). **Whose look it draws** had no home.

## Decision

**The manifest gains an optional `brand`.** It is lower case letters, digits and single
hyphens, such as `azul`, because it is a filter key: a picker lists one brand's
templates, a pack groups them. A manifest without one still loads, so a third-party pack written
before this is not broken by it.

**Every built-in template names one**, and the contract test pins which. `agenda-semana` and
`aprovados` are `azul`; `carrossel-lista` and `promo-curso` are `tyto-demo`. The
brand module those two Azul templates draw with, `templates/_azul/` (ADR 0047), is
named after the same key.

**The brand is not a closed list.** A kind is closed because its values are the house's words
for pieces. A brand is whoever commissions templates, and a new one arrives with its first
template.

## Consequences

The four built-ins take a minor version: adding an optional key breaks no brief, and every
render is unchanged.

Nothing reads the brand yet. Showing it in the desktop picker, or filtering `tyto` commands by
it, is a card of its own; this decision makes the fact exist, in the one place a template's
contract is read without running code.
