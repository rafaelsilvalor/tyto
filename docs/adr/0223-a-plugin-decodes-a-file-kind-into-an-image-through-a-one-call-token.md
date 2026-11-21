# 0223 — A plugin decodes a file kind into an image, through a one-call token

Status: accepted · 2026-11-20 · TYTO-742 · builds on ADR 0011, ADR 0041, ADR 0111, ADR 0117,
ADR 0130, ADR 0138, ADR 0149, ADR 0150, ADR 0212 and ADR 0222

## Context

ADR 0222 has a designer paint external art in the guide's PSD and export a PNG beside it, which
the brief then reads. The export is a step a person forgets, and a PNG that is older than its
PSD draws yesterday's art with no warning. The brief should be able to cite the `.psd` itself.

Tyto draws only what a browser draws: `@tyto/io` reads a file beside a brief as a data URI when
its extension is one of `EMBEDDABLE_MIME` (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.avif`,
`.svg`), and anything else is `E_ASSET_NOT_FOUND`. Teaching core or io to read a PSD would make
Tyto know a format (ADR 0011's rule for providers holds for formats too: the core gains generic
services, never one vendor's file), and a PSD reader is a large dependency with a canvas
stand-in. So the reading lives in a plugin, and the host gains a generic way to ask one.

TYTO-742 lands in pull requests: this record and the plugin-api point; core and io (the codes,
the cache, the fragment, ADR 0222's fixes); the command line's wiring; the desktop's wiring with
a stand-in decoder in an e2e; the version pull request; then the PSD plugin in its own repository
(`tyto-plugin-psd`) and its gallery entry. This record settles all of them.

## Decision

1. **A new extension point, `image-decoder`, modelled on `asset-source`.** A plugin registers
   `{ id, extensions: ['.psd', …], decode }`. An extension is a dot and lowercase letters or
   digits; the file's is compared lowercased, at its last dot, so `capa.guide.PSD` is `.psd`.
   The first decoder registered for an extension wins it, as a scheme does (ADR 0117). One call:
   `decode(file, { layer? }) → Result<{ bytes }>`, `bytes` a PNG of at most 32 MiB
   (`IMAGE_DECODER_MAX_BYTES`, which is `ASSET_SOURCE_MAX_BYTES`), bounded on the wire with
   `boundedBytes` and again by whatever caches it, because an in-process decoder crosses no wire.
   The bytes cross the desktop's JSON channel with the `$tytoBytes` marker (ADR 0050). The
   registration is deliberately generic, an id and a list of extensions, so a later point that
   previews a file kind without drawing it in an artwork (TYTO-367) can take the same shape.

2. **The plugin reads the file through a token, never a path.** For each `decode` call the host
   mints a random token bound to the plugin it asks and to one file, and hands the plugin
   `file = { token, name, size }`: the file's own name, never its path. The plugin reads parts
   with `host.decoding.read(token, { offset, length })`, the new requested capability
   `decodeReadPart`, with ADR 0212's part rules: short at the end, empty past it, `length` at
   most 32 MiB per message and 8 MiB advised (`PLUGIN_FILE_PART_BYTES`), and never more bytes
   than asked whatever the adapter answers. **The token is spent when the call answers or
   throws.** A token that is spent, minted for another plugin, or never minted is refused with
   one message, `E_PERMISSION`, so a plugin learns nothing about another's calls; a host with no
   decode port refuses every token the same way. No `workspace:read` is needed: the grant is the
   one file the brief cited, for the length of one call, so a decoder works on a file outside a
   workspace and in `tyto watch`, which has no workspace (ADR 0212). `decodeGrants()` in
   `@tyto/plugin-api` is the token table: its `decode(decoder, subject, request)` mints and
   spends, and its `readPart` is the host's `decodeReadPart` port. The host's adapter (io, next
   pull request) reads a part through an open handle, so a 100 MB PSD is never whole in memory on
   the host's side.

3. **The protocol is 30 and `@tyto/plugin-api` takes a minor** (ADR 0149). A host on 29 refuses
   the new point's registration and the new request as an unknown capability, so
   `RPC_PROTOCOL_VERSION` moves from 29 to 30. A plugin built before 30 runs unchanged.
   `@tyto/plugin-api/testing` gains `harness.decode(name, bytes, { layer })`, which runs a
   plugin's decoder over the same token table and wire as the host (ADR 0150), so the PSD
   plugin's repository tests a real decode.

4. **The host asks a decoder only for an extension it cannot embed itself.** Asset resolution
   (io) asks `decoderFor(registry.imageDecoders(), name)` when the file's extension is not in
   `EMBEDDABLE_MIME`; a decoder that claims `.png` is never asked about one. The core stays
   Node-free and gains two generic codes, never a format's name:
   - `E_ASSET_DECODER_MISSING`: the brief cites a file of an extension no picture is drawn from
     and no installed plugin decodes; it names the extension and says a plugin is needed.
   - `E_ASSET_DECODE_FAILED`: the decoder answered an error, threw, crossed a refused answer, or
     answered bytes that are not a PNG; it carries the plugin's own message. **Never a blank
     picture**: the slot stays unset as for a missing file, and the rest of the brief renders.

5. **The answer is cached on the host's side, keyed by content.**
   `TYTO_HOME/cache/decoded/<plugin>/<sha256(source hash, layer, plugin@version)>.png`. The source
   hash is streamed from the file, never read whole, and memoised by (real path, size, modified
   time), because today's file resolver reads whole files on every resolve and a 100 MB PSD on
   every keystroke would be felt. The plugin's version is in the key, so an update that draws
   differently is asked again. An entry is kept until deleted, as a source's is (ADR 0117).

6. **A layer is named after `#`.** `capa.psd#arte` asks for the layer `arte`; a layer inside a
   group is `group/layer`. `#` has no meaning in a brief's reference today, so the split is
   narrow: at the **last** `#`, only when the part before it ends in an extension a decoder
   claims, and only when the literal file (`capa.psd#arte` as a name) does not exist. Names are
   exact, case included. A layer name two layers share is an error from the decoder, never the
   first of them. Without a fragment the decoder answers the whole file's composite.

7. **ADR 0222's per-format copies are fragment-aware, and a guide is one extension.**
   `externalArtVariant` puts the format before the fragment (`capa.story.psd#arte`) and treats
   `.guide.psd` as one extension, so the copy of `x.guide.psd` is `x.<format>.guide.psd`, which is
   what ADR 0222 decision 2 names, where the probe today would look for `x.guide.<format>.psd`.
   `tyto guide` does not write `x.guide.guide.psd` when the cited file is itself a `.guide.psd`.
   Both are fixed in the core and io pull request; ADR 0222 carries a note pointing here.

8. **An untrusted folder decodes nothing new.** As the source cache does (ADR 0111), a
   restricted folder serves a decoded picture already in the cache and asks no plugin; a miss
   is `E_ASSET_DECODE_FAILED` whose message says to trust the folder. `tyto watch` decodes,
   unlike a fetch (ADR 0118): a decode reads only a file already on this machine and reaches no
   network, so an inbox filled unattended asks nothing a person did not put there.

9. **A delivery copies the decoded PNG, not the PSD.** `recordingAssetResolver` records the
   cached PNG and marks it like a fetched asset, so a `--folder` delivery (ADR 0118, ADR 0161)
   copies it under a name taken from the reference, the fragment folded in (`capa.psd#arte` →
   `assets/capa-arte.png`), and points the copied brief at it. The delivery then renders with no
   plugin, which is what a delivery is for; the PSD is the designer's working file, can weigh
   100 MB, and already sits in the delivery folder beside the cited name (ADR 0222).

10. **The PSD plugin lives in its own repository** (`tyto-plugin-psd`, ADR 0151) and reads with
    `ag-psd` 34.2.2, MIT. Measured while planning: its reader needs `initializeCanvas` with a
    `createImageData` stand-in, and its CommonJS build `require`s `util` live in the `CAI `
    handler, so the bundle keeps that import. A PSD saved without "maximize compatibility" stores
    a transparent composite; the plugin answers an error that asks the author to name a layer,
    never the blank picture. Fixtures saved by real Photoshop come from the maintainer.

## Rejected

- **A path and `workspace:read`.** The plugin would be granted the whole folder to read one
  file, would not work on a file outside a workspace, and `tyto watch` has no workspace.
- **The whole file in the call's arguments.** A 100 MB PSD over one 32 MiB message is refused,
  and the host would hold it whole.
- **A token that lives until the plugin stops.** A plugin that kept one would keep reading a file
  the brief no longer cites; one call is the grant's natural length.
- **Decoding in core or io with `ag-psd`.** Tyto would know a vendor's format and carry its
  canvas stand-in in every host (ADR 0011).
- **A third code for a refused token.** `E_PERMISSION` already says a plugin asked for what it
  was not granted, and the token is the grant.

## Consequences

- A brief may cite `capa.psd` or `capa.psd#arte` once the PSD plugin is installed; without it,
  the author is told which extension needs a plugin.
- A plugin decodes files it was never granted a folder for, one at a time, only while the host
  asks; nothing else of the disk is reachable through a token.
- `E_PERMISSION`'s message says "at install time", which reads oddly for a spent token; the
  capability text names the token, and a clearer wording is a catalog change for a later card.

## Notes

- **2026-11-20 (TYTO-742, core and io): the split lives in io, and core asks where it fell.**
  `decodedAssets` in `@tyto/io` wraps the file resolver, inside the source cache, and is the
  one place decision 6 is read: it locates the literal name through the file resolver's new
  `locate`, which finds a file in the same folders without reading it. Core cannot ask a disk,
  so the asset port gains an optional `layerOf(reference)`, answered after `resolve`, and
  `resolve` hands it to `externalArtVariant` to put the format before the fragment; a wrapper
  that does not forward it reads the reference as one file's name. A reference whose literal
  name is not a file while the part before its last `#` is a file no decoder claims is
  `E_ASSET_DECODER_MISSING` too: "not found" would send the author looking for a file that
  is there. A literal name whose last dot is followed by more than letters and digits
  (`capa.psd#arte` as a real file) is the file resolver's, as before. A decoded picture is an
  `AssetRef` of source `url`, which is how `recordingAssetResolver` marks a fetched one; the
  delivery's name folds a layer in after the file's stem, its separators cut like a
  reference's (`capa.psd#grupo/arte` → `capa-grupo-arte.png`). The command line and the
  desktop compose the cache in the next pull requests.
- **2026-11-20 (TYTO-742, the command line): one token table per process, and trust as a
  source's.** The CLI starts the installed plugins once per process, so it keeps one
  `decodeGrants()` beside them (`processDecodeGrants`): every command's capabilities serve
  `decodeReadPart` from it, and a render task's `decodedAssets` mints through its `decode`. The
  plugin's version for the cache key is read from its manifest. `TaskSources.decodes` follows
  `fetches` unless a command says otherwise: `tyto render` decodes outside any workspace and in a
  trusted one; `tyto watch` decodes though it never fetches (decision 8); `tyto mcp` decodes in
  a trusted workspace only, for a check as for a preview, because a decode reaches no network.
  Under `tyto mcp` the decoded cache wraps the real-path confinement rather than the reverse:
  `realPathConfined` confines `locate` too, so the cited file must be inside the folder's roots,
  and the PNG in `TYTO_HOME/cache/decoded/` is answered outside that check, never through it.
  `tyto guide` names a cited layer's guide after its file: `capa.psd#arte` gets `capa.guide.psd`
  and expects `capa.psd` back, cut at the last `#` when the part before it has an extension and
  no file has the literal name; which plugin decodes it is the render's question, not the
  guide's. With no `TYTO_HOME` the cache is not composed, so a cited `.psd` stays
  `E_ASSET_NOT_FOUND` there; a CLI always has a home in practice.
- **2026-11-20 (TYTO-742, the desktop): one token table in main, and typing decodes.** Main
  keeps one `decodeGrants()` for its life, beside the capabilities every plugin process is
  started with, as the command line keeps one per process; `desktopSources` composes one
  `decodedAssets` for the process inside the source cache, so the hash memo outlives a compile.
  The preview asks the window plugins' decoders and an export asks its run's host, as each
  asks its sources. Unlike a fetch (ADR 0119), a compile while typing decodes, and so does the
  queue, as `tyto watch` does: a decode reaches no network, and a PSD saved again must redraw
  the preview with no save of the brief. A restricted folder decodes nothing new, the queue's
  included, its miss naming Workspace: Manage Trust; an unsaved brief has no folder and decodes
  nothing. The
  preview's `references` (TYTO-741) name the file a layer is drawn from, `capa.psd` for
  `capa.psd#arte`, so saving the PSD is what recompiles the brief, and the hash memo then sees
  a new modified time and the cache key a new hash.
- **2026-11-21 (TYTO-742, the plugin): decision 10 misread `ag-psd`'s `CAI ` handler.** In
  34.2.2 the `require('util')` it names is not live: the whole handler sits inside a block
  comment (`dist/additionalInfo.js:2746`, between `/*` at 2731 and `// */` at 2752;
  `dist/bundle.js:3256`, between 3241 and 3262). The plugin's built bundle calls no `require`
  (the only match for `require(` is esbuild's `__require` helper), so it imports nothing at
  run time. The rest of decision 10 holds: the reader still needs `initializeCanvas` with a
  `createImageData` stand-in. The plugin's manifest name is `psd-decoder`, not `psd`, because
  Tyto ships a built-in exporter named `psd` and a second plugin of that name is
  `E_PLUGIN_DUPLICATE`; its decoder's id stays `psd`. The repository is tagged `v0.1.0` and
  the gallery lists it under the id `psd-decoder`.
- **2026-11-21 (TYTO-742, external art): a file that cannot be drawn says why on an external
  slot too.** An external slot (ADR 0220) answered every miss with `W_EXTERNAL_ART_MISSING`,
  "not found", so a `fundo.guide.psd#arte` that was there with no decoder installed, or whose
  layer the plugin did not find, sent the author looking for a file on the disk. `resolve` now
  asks the asset port's `explain` for the cited file and for each format's copy (ADR 0222) that
  did not resolve, and reports what it answers at the slot's range, with the plain slot's code
  and message. **The severity is the plain slot's**: `E_ASSET_DECODER_MISSING` and
  `E_ASSET_DECODE_FAILED` stay errors and stay non-fatal, so the render goes on and ADR 0220's
  outlined box still stands in for the art. The cited file's reason takes the place of
  `W_EXTERNAL_ART_MISSING`, which is kept for a file that is not there, and is reported only
  while a format would draw it: one copy per format is a whole set of art. A copy's reason is
  reported beside it, and its format falls back as for a copy that is not there. **A guide
  asks nothing**: `ResolveOptions.guide`, set by the job when it compiles one, skips `explain`
  for external slots, because in a guide the art is empty and `tyto guide` must write the guide
  for a `.psd` no plugin decodes yet, the cited guide itself included; the slot then says
  `W_EXTERNAL_ART_MISSING`, which `tyto guide` hides.
