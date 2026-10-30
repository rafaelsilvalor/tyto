---
'@tyto/plugin-api': minor
---

The gallery index (TYTO-503, ADR 0162). `parseGalleryIndex` reads `index.yaml`, tolerant per entry with ranged diagnostics; `galleryStatus` measures each entry against a folder's plugin files and lock (installed, update available, not installed, and whether its `engine` admits this Tyto); `sameRepository` compares two spellings of one git location. `addTemplateEntries`, `moveEntryRef` and `newPluginFileText` write a plugin file by splicing its own bytes, then refuse an edit that would change any entry it did not mean to.
