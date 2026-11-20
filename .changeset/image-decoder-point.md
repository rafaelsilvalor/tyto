---
'@tyto/plugin-api': minor
---

A plugin may register an `image-decoder` (TYTO-742, ADR 0223): `{ id, extensions, decode }`,
where `decode(file, { layer })` answers a PNG of at most 32 MiB (`IMAGE_DECODER_MAX_BYTES`).
The file is never handed over as a path: `file` is `{ token, name, size }`, and the plugin reads
it in parts with `host.decoding.read(token, { offset, length })`, a token good for its own plugin
until the call answers; any other is `E_PERMISSION`. `decodeGrants()` is the host's token table,
`decoderFor` picks a decoder by extension, and `HostCapabilities.decodeReadPart` is the new port.
`@tyto/plugin-api/testing`'s harness gains `decode(name, bytes, { layer })`.
`RPC_PROTOCOL_VERSION` is 30.
