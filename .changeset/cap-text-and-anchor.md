---
'@tyto/template-kit': minor
---

`capText` draws text placed by the top of its capitals as a measured block, with `capOffset`, `plainRuns`, `FontMetrics` and `DEFAULT_METRICS`; a `Block` may carry an `anchor` (its first capitals and last baseline) that `stack`, `row` and `inset` pass on, absent where no child has words; and the slot readers `slotText`, `richTextOf`, `slideRichLines`, `slotRichLines` and `trimmed` move into the kit from the template repositories that copied them (TYTO-793, ADR 0230).
