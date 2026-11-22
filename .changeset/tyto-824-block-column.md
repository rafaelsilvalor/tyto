---
'@tyto/template-kit': minor
---

TYTO-824: `blockColumn` lays a template's information blocks out as one column over an area
(ADR 0224): in the brief's order (`context.order`, ADR 0225), a block the brief left out taking
no room, the gaps the template states per pair, and the group centred between the area's top and
bottom, with what does not fit reported as `overflow`. `weightOf` reads a slot's `peso`
adjustment (`1`, `2`, `3`) as the scale its block is built at, 0.85, 1 and 1.2 by default. Every
number the column uses is a declared parameter in `BLOCK_COLUMN_PARAMETERS`, read with
`parameterValues`; `Area` and the parameter schema types are exported for the pieces that follow.
