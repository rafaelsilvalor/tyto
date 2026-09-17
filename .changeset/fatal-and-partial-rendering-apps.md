---
'@tyto/cli': minor
'@tyto/desktop': minor
---

TYTO-107 — a stage may produce a value and still report errors

The preview keeps drawing while one directive is half-typed: an unclosed `**` costs that
directive and nothing else, so the artwork stays on screen and the problems panel names what
is wrong (ADR 0025). TYTO-108 marked the last good preview as stale; this renders the
current one, minus the broken part.

`tyto render` agrees with it. A brief with an unknown slot writes its artifacts, exits 1, and
its `result.json` is `status: error` with those files listed — _rendered, with errors_, which
`docs/render-contract.md` now describes.

A brief with no usable template still renders nothing, and so does one whose frontmatter will
not parse or that leaves a required slot unset. The gap has to be visible in the artwork
before a missing required slot can be skipped, and nothing draws it yet.
