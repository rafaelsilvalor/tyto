---
---

Test-only for the desktop (TYTO-301): `theme-pack.test.ts` and `renderer-tokens.test.ts` hold
vim's four badge colours at least CIEDE2000 ΔE 10 apart in every theme, measured by a new
`colour-difference.ts` that only tests import. Tyto Light's and Tyto Dark's badges already
passed (closest 22.8 and 24.2) and do not change. Nothing in the desktop ships differently.
