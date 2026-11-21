---
'@tyto/core': patch
'@tyto/pipeline': patch
'@tyto/command-line': patch
---

An external-art slot whose cited file is there and cannot be drawn says why, as a plain
picture slot does: `E_ASSET_DECODER_MISSING` when no installed plugin decodes it, and
`E_ASSET_DECODE_FAILED` with the plugin's message when its decode failed, at the brief's line.
The outlined box still stands in for the art. A guide asks no decoder: `tyto guide` writes the
guide for a cited `.psd` with no plugin installed, the guide itself included.
