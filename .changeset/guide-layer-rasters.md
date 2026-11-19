---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/pipeline': minor
---

An exporter may answer a file's bytes (ADR 0221): `exportFrame` returns
`Result<string | Uint8Array>`, and an isolated exporter's byte answer crosses the boundary,
so `RPC_PROTOCOL_VERSION` is 29. A guide layer may carry its `raster`, and the pipeline's
new `rasterizeGuideLayers` stage draws every layer but `arte` through the HTML exporter and
the rasterizer before the render, when `JobRequest.guide` asks `compile` for a guide; the
bytes reach the exporters' store through the new `JobPorts.storeAssets`. A render without a
guide is unchanged.
