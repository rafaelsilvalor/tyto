---
'@tyto/template-lang': minor
---

Component parameters: a `<use>` decides which slot its component draws (TYTO-75).

`<define name="linha" params="texto">` declares a parameter, `slot="texto"` in the body names
it, and `<use component="linha" texto="titulo">` binds it. Every attribute on a `<use>` other
than `component` and `class` is a binding. Without this a component repeated shape; with it,
content.

The substitution runs on the component's children **before** they are expanded, and therefore
before anything validates them. Nothing downstream knows a parameter existed: `slot="rodape"`
written by hand and `texto="rodape"` bound to a component are the same undeclared slot with
the same `E_TEMPLATE_MARKUP`, the type check still refuses a `<text>` bound to an image slot,
and `renderedSlots` counts a slot reached only through a parameter, so `W_UNUSED_SLOT` does
not fire on it. The range on such a refusal is the **binding's**: the `<define>` is correct and
the `<use>` is not.

Three places in a body name a slot and a parameter is substituted into all three — `slot="…"`,
a `{…}` spliced into a `src`, and a nested `<use>`'s own binding, which is how a parameter is
handed one component further down.

Refused with a range: an unknown parameter name and a parameter nothing binds (each with a
suggestion, and a typo produces one sentence rather than both), a parameter bound to nothing,
a parameter called `component` or `class`, a parameter declared twice, a parameter spelled the
way no slot could be, and a parameter carrying the name of a slot the manifest declares —
which would make `slot="titulo"` in that body mean the parameter, with no spelling left for
the slot.

A `<use>` whose parameters are not all bound is not expanded, so an unbound `slot="texto"` is
never also reported as an undeclared slot.
