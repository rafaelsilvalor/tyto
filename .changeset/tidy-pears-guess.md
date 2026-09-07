---
'@tyto/core': minor
'@tyto/brief-lang': minor
---

Add `resolve`: `BriefAst` × manifest → `ResolvedBrief`.

`resolve(ast, { registry, assets, template?, renderedSlots? })` validates a brief against
the template it names — slot existence and types, required slots, repeat counts, enum
values, adjustments allowed per slot, asset existence through the new `AssetResolver`
port, and formats — and produces typed slot values plus one artwork per occurrence of the
repeatable slot. Every diagnostic carries the range of the directive or frontmatter key
that caused it, and `E_UNKNOWN_SLOT` suggests the declared name a typo is closest to.

**The brief AST types moved from `@tyto/brief-lang` to `@tyto/core`**, where `Scene`
already lives: `resolve` consumes a `BriefAst` and `core` cannot import `brief-lang` back.
`brief-lang` re-exports them, so imports from it keep working. `BriefAst.frontmatter` is
now a `Frontmatter` — `data`, per-key `ranges` and the block `range` — rather than a bare
record, which is what lets a diagnostic point at one key.

New diagnostic codes: `E_NO_TEMPLATE`, `E_UNKNOWN_TEMPLATE`, `E_UNKNOWN_FORMAT`,
`E_BAD_SLOT_VALUE`.
