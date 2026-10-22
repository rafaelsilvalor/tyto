# 0118 — Where the CLI fetches from a plugin, and how a fetched image is delivered

Status: accepted · 2026-10-22 · TYTO-280 · under ADR 0117 and ADR 0111 · amends ADR 0057 on
the name a delivered image is copied under

## Context

ADR 0117 made a plugin's `asset-source` and `font-source` answer through a cache in
`TYTO_HOME`, and left two things to the pull request that composes it in the CLI.

- **When a run may fetch.** ADR 0117 says a restricted folder never fetches. The CLI meets a
  brief in three ways, and only one of them has a folder whose trust answers the question: a
  brief inside a workspace (ADR 0112), a brief in no workspace at all, and a task `tyto watch`
  picks up from an inbox.
- **What a `--folder` delivery names a fetched image.** ADR 0057 copies each image into
  `assets/` "by its own file name". A fetched image's file is its cache entry, named by a
  64-character hash, which says nothing to the person opening `assets/`; and the reference the
  brief wrote — `test:logo`, `drive:pasta/Logo Final` — is not a file name on every system.

## Decision

1. **A run fetches from a trusted folder, from no folder, and never under `tyto watch`.**
   - A brief inside a workspace fetches when the folder is trusted, `--trust` counting for the
     run, and reads the cache only when it is restricted. Its plugin sections are the
     resolved project's, already withheld when restricted (ADR 0111).
   - A brief in no workspace fetches. The person typed its path on the command line, there is
     no folder whose trust is in question, and no section to withhold.
   - **`tyto watch` never fetches.** An inbox is filled unattended by another system, and a
     folder picked up unattended must not change what it produces the day somebody installs a
     plugin — the reason the desktop's queue stays PNG-only. It still reads what the cache
     holds, so one `tyto render` of the same reference fills the cache for it.
2. **A miss names its real cause.** A restricted folder's says to trust the folder; under
   `tyto watch` it says the watcher never fetches and that rendering the brief once with
   `tyto render` fetches it. Telling somebody to trust a folder `tyto watch` would still not
   fetch for would be wrong advice. `sourceCache` takes the reason as `notFetchedBecause`, the
   restricted folder's being the default.
3. **A fetched image is delivered under a name taken from its reference.** The text after the
   reference's last `/`, `\` or `:` is kept; every character outside `[A-Za-z0-9._-]` becomes
   `-`; its own extension is dropped, because the cached type gives the extension; leading
   and trailing dots are removed; at most 64 characters stay. A Windows device name (`con`,
   `nul`, `com1`…) gains `-image`, and nothing left is the scheme. ADR 0057's `-2`, `-3` rule
   then tells two such names apart, compared without case. So `test:logo` is `logo.png` and
   `drive:pasta/Logo Final.png` is `Logo-Final.png`.
4. **The copied brief names the copy, and renders with no plugin.** As ADR 0057 does for any
   image, the frontmatter value `test:logo` becomes `logo.png` in `editaveis/`, which the
   delivery's `../assets` answers. The delivery is the artwork's whole record: opened on a
   machine without the plugin, or years after the source moved, it renders the same picture.
5. **Which images count as fetched is the recorder's to say.** `recordingAssetResolver` marks
   an image whose `AssetRef.source` is `url`, which only the source cache produces. A brief
   path that merely contains a colon — a legal file name on Linux — keeps ADR 0057's rule.

## Consequences

- `tyto watch` with plugin references works from a warm cache, and its first task after a
  new reference fails with the reason and the command that fixes it.
- A delivery no longer depends on the plugin that supplied its images.
- The reference's text reaches a path in one place, `fetchedStem` in `fs-outbox.ts`, and only
  after every separator is cut.
- The desktop's composition (the preview, the export box, the queue) is the next pull request
  of TYTO-280. The queue is `tyto watch`'s twin and is expected to follow point 1.
- Open: a reference whose last segment is only a number — `drive:1AbC` style ids — is
  delivered under that id, which is legal and stable but says as little as the hash did.
