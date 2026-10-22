# 0117 — A plugin source is fetched once and read from a cache

Status: accepted · 2026-10-22 · TYTO-280 · under ADR 0011, ADR 0037, ADR 0041, ADR 0042, ADR 0049, ADR 0056, ADR 0110, ADR 0111, ADR 0112 and ADR 0114

## Context

Rafael asked on 2026-10-12 that a plugin be able to supply a project's images and fonts — a
future Drive plugin serving them from the cloud, with nothing installed on the machine that
renders. `core` already had the ports: `AssetResolver` for an image, `FontSource` for a face.
Nothing let a plugin answer them. Two facts make that more than a new extension point:

- **The ports that read bytes are synchronous.** An exporter walks a scene and cannot await
  (ADR 0018), and `compile` measures text against `FontSource.outlines` while it builds the
  scene. A plugin's answer crosses a process (ADR 0041) and maybe a network, so it is never
  synchronous.
- **Which faces a scene needs is known only after `compile`.** A face is a
  `(family, weight, style)` triple in a `TextSpan`, and a template's code decides it. Images are
  easier: `resolve` names each one and already awaits its resolver.

Since the card was written, a workspace folder carries one opaque section per plugin in
`.tyto/project.json` (ADR 0112), resolved with work profiles (ADR 0114) and withheld when the
source is restricted (ADR 0111). No plugin received its section yet. A Drive-like source needs
it to know where to look.

## Decision

1. **Two extension points: `asset-source` and `font-source`.** An asset source declares the URI
   schemes it answers (`test`, `drive`): two or more lowercase characters, so `C:` in a Windows
   path is never one. A font source declares the families it serves. Each has one function,
   `fetch(reference | face, { section })`, answering bytes as a `Result`, so an installed
   plugin registers it from its own process like a directive's `transform`. Earlier
   registration wins a scheme or a family, as a template name does (ADR 0020). Built-ins
   contribute none.
2. **A source is asked in the two places that may await, and its answer goes to a cache.**
   `TYTO_HOME/cache/sources/<plugin>/`. An image is fetched while `resolve` resolves it and
   becomes an `AssetRef` whose `path` is the cached file and whose hash is its bytes', so
   `fileResources` and both exporters read it as any file and learn nothing of plugins. A face
   is fetched in the job's resource stage into `…/<plugin>/fonts/`, a folder the font library
   searches. Core stays ignorant of Drive and of the network (ADR 0011): the cache is an
   adapter in `@tyto/io`.
3. **A face is fetched only when nothing local has it, and then the job compiles once more.**
   Only a `source: 'system'` face the library could not find in a workspace font folder or the
   machine's is asked of a font source. The plugin's cache folders come last in the library's
   list, so **a plugin face never shadows a locally installed one**: offline is the same render
   as online, and a person who wants the plugin's face removes their local copy. When a fetch
   added a face, the first compile was measured against its substitute, so the job's
   `loadResources` answers `recompile` with the new faces. The job compiles again and drops the
   first pass's diagnostics, the compile's and the loader's. **At most once**: a second request
   is ignored, so no answer can loop. A cold cache costs two compiles, a warm one costs one.
4. **Kept until deleted, named by a hash.** An entry is never fetched again, so a brief renders
   the same bytes on every run. **A file changed at its source is not seen until its cache
   entry is removed**: that is the price of determinism, and refreshing is not built. The
   name is `sha256(reference)` for an image, plus the extension of the type it answered, and the
   family followed by `sha256(plugin, face)` for a face, since the library opens only files
   named after the family. **Never the reference's text**: a reference comes from a brief, and
   a brief does not choose a path on this disk. Entries are written beside their name and
   renamed into place, so a killed run leaves no truncated entry.
5. **A restricted source never fetches.** A brief or a project in a restricted folder reads
   what is already cached and asks no plugin for anything else (ADR 0111). A reference in a
   brief nobody trusted is an instruction to installed code that has the network, which is the
   reason ADR 0111 withholds plugin sections. The miss says so: "this folder is not trusted, so
   no plugin fetches for it; trust the folder to fetch".
6. **The plugin's section rides on every call, not on activation.** `fetch` is handed
   `{ section }`, the plugin's own section of the resolved project. It is absent when the
   folder has none or withheld it. A plugin's process outlives the folder that was open when
   it started, so a section handed at activation would be the wrong folder's after File ▸ Open
   Folder. Other points (`directive`, `exporter`) receive no section yet.
7. **Failures are diagnostics, never a silent substitution** (ADR 0037's rule). An image a
   source could not supply is `E_ASSET_SOURCE_FAILED` naming the plugin and its reason, in place
   of `E_ASSET_NOT_FOUND`: `AssetResolver` gained an optional `explain(reference)` that `resolve`
   asks after a miss. A face is `W_FONT_SOURCE_FAILED` beside the `W_FONT_SUBSTITUTED` the
   library already reports, since the face is then drawn as any missing `system` face is
   (ADR 0037), not refused as a missing bundled one is (ADR 0110). A face that failed is not
   asked again by the same cache, and is reported on each pass.
8. **What crosses, and how much.** Bytes, never handles: `{ bytes, mime }` for an image, the
   outline bytes for a face, base64 across the desktop's JSON wire (`plugin-wire.ts`). At most
   **32 MB per image**, the ceiling a file beside a brief already has, and **16 MB per face**.
   Both are checked on the wire and again by the cache, because an in-process source crosses
   no wire. An image's type must be one a document embeds (`EMBEDDABLE_MIME`). The network is
   still `host.fetch` under `net:<host>` (ADR 0042), and the confinement is the spawned
   process's (ADR 0049), because a permission flag that is accepted is not one that is
   enforced.

## Consequences

- A Drive plugin is one `asset-source` and one `font-source`, and nothing in `core`, the
  exporters or the job knows its name.
- TYTO-281, Google Fonts on first use, is a `font-source` and needs nothing new from this.
- The composition is the CLI's and the desktop's (`sourceCache` in `@tyto/io`, the font
  library's `refresh` in `@tyto/fonts`), in this card's later pull requests.
- A `--folder` delivery copies the images a brief resolved into its `assets/` under the name
  the brief wrote. A plugin reference is not a file name, so that copy is left to the
  composition pull request to settle.
- Open: refreshing or invalidating an entry, a size limit on the cache as a whole, and a
  plugin face whose file names another family inside it, which the library ignores and which
  is then drawn as a substitute with no `W_FONT_SOURCE_FAILED`.
