---
'@tyto/core': minor
---

Add `SceneVisitor<T>` and `walk()`, the one traversal of the Scene IR. Every node is handed a `VisitContext` carrying the accumulated transform as a `Matrix`, the effective opacity, the ancestor chain, and the frame and format it belongs to, so no exporter composes any of that a second time. A visitor never recurses: `walk()` descends and gives `group()` the results its children already produced. Hidden nodes are visited rather than skipped — a mask is often `visible: false` and still has to be rendered — and the decision to ignore one belongs to the visitor.

Ships the first two callers: `parseScene`'s invariants, and `frameBounds`/`sceneBounds`, which give the axis-aligned box the visible nodes occupy. Bounds are layout bounds, not ink: stroke overhang and effects are excluded. `Bounds.exact` is false when a node did not fully declare its own box — a text sized by its content, or one that may `grow` — so the box is at least that large and never smaller, and a caller that must not clip knows to pad until E4.5 measures laid-out text.
