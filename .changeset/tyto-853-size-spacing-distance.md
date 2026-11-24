---
'@tyto/template-kit': minor
---

TYTO-853: a block's letters, its inner spaces and the room above it come apart. `peso` takes
`1` to `8` (`weight6` to `weight8`: 1.6, 1.8, 2); `tamanho` scales only the letters and
`espaco` only the spaces inside the block, each replacing its side of `peso`; `distancia`
multiplies the gap above its block (`distance1` to `distance5`: 0, 0.5, 1, 1.5, 2).
`scalesOf(slot)` reads all four for a column entry, which now carries `spacing` and
`distance` beside `scale`; `build` receives the spacing as a third argument, and
`bodyBlock` takes it as a fourth. A brief that writes none of the new adjustments draws as
before.
