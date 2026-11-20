---
'@tyto/core': minor
'@tyto/io': minor
'@tyto/command-line': patch
---

A brief may cite a file a plugin decodes (TYTO-742, ADR 0223), once a host composes the new
cache. `@tyto/core` gains `E_ASSET_DECODER_MISSING` and `E_ASSET_DECODE_FAILED`, the asset
port's optional `layerOf(reference)` with the `AssetLayer` type, and an `externalArtVariant`
that puts the format before a layer's `#` and reads `.guide.psd` as one extension, so the copy
of `x.guide.psd` is `x.<format>.guide.psd`. `@tyto/io` gains `decodedAssets`, which locates a
file without reading it, hashes it as a stream remembered by real path, size and modified
time, and keeps the decoder's PNG in `TYTO_HOME/cache/decoded/<plugin>/`; a restricted folder
is served the cache only. The file resolver gains `locate`, and a delivery copies a decoded
layer as `<stem>-<layer>.png`. `tyto guide` no longer names a guide `x.guide.guide.psd` when the
cited file is a guide itself.
