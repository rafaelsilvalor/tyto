---
'@tyto/core': minor
'@tyto/pipeline': minor
---

Text is measured and wrapped in the IR (E4.5).

`compile` now takes `faces`, a `FaceCache` built from the new `FontSource` port, and uses it
to decide where every line of a `TextNode` ends. The breaks come back as `LineBreak` runs,
so both exporters draw the same lines instead of each guessing — which closes ADR 0019's
"an SVG does not wrap". `overflow: 'shrink'` is resolved the same way: the runs come out at
the size that fits and the node becomes `'clip'`, because the shrink has happened.
`W_TEXT_OVERFLOW` reports what still does not fit, naming the brief's directive and
carrying its range.

Measuring is fontkit over the bundled outlines, and it agrees with Chromium: on the
`text.feed` corpus the line counts match exactly and the block heights are within 0.0125px,
against a ±1px criterion.

`JobPorts.faces` passes the cache through `@tyto/pipeline`. Both options are optional and a
caller that omits them gets exactly the previous behaviour — no adapter supplies fonts to a
production job yet, so nothing changes for the CLI until one does.
