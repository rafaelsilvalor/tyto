---
'@tyto/io': minor
---

The gallery on a disk (TYTO-503, ADR 0162). `fetchGalleryIndex` reads `index.yaml` from a repository's default branch with the person's `git` and keeps the copy fetched last in `TYTO_HOME/cache/gallery/`, read with `W_GALLERY_INDEX_OFFLINE` when a fetch fails. `readGalleryRecord` and `writeGalleryRecord` keep `plugin-files/gallery.json`, what the gallery wrote; `writeFileAtomically` writes beside a name and renames into place.
