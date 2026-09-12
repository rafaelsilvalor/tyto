---
'@tyto/core': minor
---

`min` on a non-repeatable rich-text slot is enforced (TYTO-67).

`slotSchema` accepted it, `docs/template-authoring.md` said it counted characters, and
`resolve` had no branch for it at all: `titulo: { type: rich-text, min: 10 }` parsed,
rendered, and never once complained about a two-character title. A rule the manifest takes
and nothing applies is worse than no rule, because the author trusts it.

It is an **error**, `E_BAD_SLOT_VALUE`, carrying the range of the directive that set the
value — the same code, shape and range behaviour `max` already had two lines below it. The
card left the severity open and listed a warning as the alternative; the deciding evidence
is that `finish()` already reports both ends of the pair as errors on a **repeatable** slot,
and the document calls `min` and `max` one pair with two meanings. A warning here would have
given two keys three behaviours across two slot kinds, which is a rule nobody can hold.

`max` is unchanged and now pinned by a test that asserts its whole message, so this card
could not move the other end of the pair while adding one.
