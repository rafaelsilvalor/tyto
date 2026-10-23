# 0124 — The preview shows a subject of a kind; an image arrives by explorer id as a data: URI

Status: accepted · 2026-10-23 · TYTO-366 · amends ADR 0084 (what a following preview follows)
and ADR 0115 (what a click in the explorer does) · under ADR 0010 and ADR 0111

## Context

Rafael asked on 2026-10-23 that a click on an image in the explorer show it in the preview. Until
then a click on anything but a `.brief` did nothing (ADR 0115), so checking the photo or logo a
brief uses meant leaving Tyto. He also asked that this leave room for other file kinds later:
`.txt` and `.md` (TYTO-247) and a plugin's viewer for Photoshop or Illustrator files (TYTO-367).

The window never holds a path (ADR 0010, ADR 0086), the explorer names files by ids main mints
(ADR 0115), and the preview's frame is `sandbox=""` under a CSP whose `img-src` is
`'self' data:`. An SVG is a document format that can carry scripts and external loads.

## Decision

1. **A preview tab shows a subject of a kind**, not always a brief: `{ kind: 'brief', documentId }`
   or `{ kind: 'image', entryId }` (`PreviewSubject` in `editor-groups.ts`). The tab keeps
   `documentId` for a brief and gains an optional `subject` for a file, so every lookup by
   document stays as it was. It is not a new tab kind and not a read-only editor tab. The union is
   open on purpose: TYTO-247 and TYTO-367 add kinds to it.
2. **A following preview shows the last thing chosen.** A click on an image (or Enter on it)
   points the following preview at it, or opens one the way "Open preview" does. A brief brought
   to the front — a different brief in front of the focused group, or its tab chosen — makes it
   follow that brief again (`followBriefAgain`). Lock locks the image; at most one locked preview
   per subject. **The focus stays in the explorer**, so its keys go on choosing. A double click
   does nothing more. This amends ADR 0084: the preview no longer follows only the brief in front.
3. **One path to the screen.** The image's document is a synthetic frame, `{ width, height, html }`
   whose HTML is one `<img src="data:…">` and nothing else (`imageDocument`). It goes into the
   same sandboxed iframe through `showDocument`, sized and scaled by the same `paintFrame` and
   `fitZoom`, so zoom, Fit and Lock work as for a brief and Fit never enlarges past 1:1. The bar
   holds a line — "logo.png · 1200 × 630 px · 84 KB" — in place of the formats; the modes, the
   strip and its toggle are hidden, and `stripHidden` and `mode` stay a brief's. The pixel size is
   the window's `img.decode()`, not a header parser.
4. **An SVG with no `width` and `height` of its own is shown at its viewBox, marked scalable.**
   Measured first: Chromium answers `naturalWidth × naturalHeight` = **300 × 150** for an SVG with
   only a viewBox, the default object size, which says nothing about the drawing. So the window
   reads the root element's `viewBox` (`svgViewBoxSize`), and uses the decoded size otherwise.
5. **A strict channel, `explorer:image`**: `{ entryId, have? }` answers
   `{ ok: true, name, mime, bytes, version, dataUrl }`, `{ unchanged: true }`, or
   `{ ok: false, reason: 'gone' | 'too-large' | 'unsupported' | 'failed', name?, bytes?, version? }`.
   `version` is `mtimeMs:size`. Main's `filePath(entryId, extensions)` generalises `briefPath`:
   the id names a listed file whose extension is one asked for and whose real path is still a file
   inside the folder. Then main **calls `stat` before reading** and refuses over the ceiling
   without reading; checks the first bytes against the extension (PNG, JPEG, GIF, WebP magic; an
   SVG must be UTF-8 text holding `<svg`) and **chooses the MIME type itself**. The ceiling is
   32 MiB, `ASSET_SOURCE_MAX_BYTES` (ADR 0117), with a Zod `.max()` on the URI. `too-large` and
   `unsupported` carry the version too, so a watcher event over an unchanged file is a `stat`.
   The CSP does not change. Extensions: png, jpg/jpeg, webp, gif, svg.
6. **Changes on disk.** On `explorer:changed` each image a preview shows is asked again with
   `have`, and main answers `unchanged` after a `stat`; a file is never re-read per watcher event.
   A rename keeps the id and the next answer carries the new name. A delete, a removal outside the
   app, or another folder opened answers `gone`: a following preview goes back to the brief in
   front, a locked one says "This file is no longer in the folder." Over the ceiling the stage says
   the size; bytes that do not match, or a decode that fails, say the file cannot be shown.
7. **The session does not keep a locked image preview**: explorer ids are per run (ADR 0010). A
   locked image names no document, so `sessionOf` drops it with the documents it does not keep; a
   following preview showing an image is kept as a following preview, which shows the brief.
8. **An SVG is a picture, by three layers, each measured** (`e2e/explorer-image.desktop.test.ts`,
   a local 127.0.0.1 server counting hits, a fixture SVG with an external `<image href>` and a
   `<script>` that fetches): in the preview 0 of 2 hits; the same file loaded as a document in a
   window with no sandbox and no CSP, 2 of 2 — the control without which 0 proves nothing.
   Removing layers one at a time (2026-10-23): the SVG inlined as markup, 0 of 2; inlined and no
   `sandbox`, 0 of 2; inlined, no `sandbox` and no CSP, 2 of 2; the `<img>` kept with no `sandbox`
   and no CSP, 0 of 2. Each layer holds on its own. A unit test pins the first: the document is
   exactly one `<img>` of the URI and no SVG markup.
9. This amends ADR 0115: `explorer:open` is no longer the only effect of a click in the explorer.

## Rejected

- **A custom scheme (`tyto-file://<id>`) instead of bytes.** No copy across the bridge, but a new
  protocol handler and a CSP change for every frame, and a URL the frame could ask for again
  after the id stopped meaning anything. 32 MiB in one answer is within what the bridge carries.
- **Inlining an SVG as markup**, which would let CSS colours and fonts apply. It makes the frame a
  live document whose safety rests on the sandbox and the CSP alone.
- **A read-only editor tab per image.** A second kind of tab with its own strip entry, session
  record and commands, for what the preview already draws.
- **The arrows updating the preview as they move the selection.** Not added: an arrow selects in
  the tree everywhere else, and an image read per key press would be up to 32 MiB per key. It is
  proposed to Rafael for a later card.

## Consequences

- `preview.ts` paints two subjects: `paintPreview` for a brief and `paintImage` for an image,
  through one `paintFrame`. A brief painted after an image gets its bar back.
- The zoom commands act on the image in front when there is one; the other brief commands with an
  image preview focused act on the brief behind it, as they do with a brief's preview.
- New strings, in both locales: `preview.image.scalable`, `preview.image.tooLarge`,
  `preview.image.unsupported`, `preview.image.gone`.
