---
'@tyto/core': minor
'@tyto/template-kit': minor
'@tyto/templates': patch
---

`compile(..., { guide: true })` builds the guide for art painted outside Tyto (ADR 0220): every
external slot left empty, an outlined area named by its slot for each node a text or picture
slot produced, each frame's new optional `guide` cutting its top-level nodes into the `texto`,
`areas`, `arte` and `decoracao` layers, and one empty canvas per `inline` slot. `parseScene`
refuses a guide that does not cut its frame exactly. Without `guide` a Scene is what it was.
`compileTemplate` takes the same `guide` option, and `arte-teste` pins its guide Scene.
