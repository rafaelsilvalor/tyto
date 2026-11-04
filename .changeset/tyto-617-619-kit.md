---
'@tyto/core': minor
'@tyto/template-kit': minor
---

`@tyto/core/template` exports `fallbackChain`, the symbol fallback chain of ADR 0168, so a template's faces test derives the chain's faces instead of copying the rule (TYTO-619). The kit's `rebreak` never inserts a break before a standalone math operator, keeping ADR 0169's rule when it pulls a word down to an orphan (TYTO-617), and `highlightsFromValues` takes the template's declared faces and snaps `highlight-weight` to the nearest of them, a tie going to the heavier (TYTO-619).
