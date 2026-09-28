---
'@tyto/pipeline': minor
'@tyto/cli': minor
'@tyto/desktop': minor
---

TYTO-197: exported files are named by format and number: `<format>-<NN>.<ext>` (ADR 0053). The artwork's id stays in `result.json`, beside each file's name.

```
before (TYTO-194)            after
lamina-1-grid.png            grid-01.png
lamina-2-grid.png            grid-02.png
artwork-1-grid-1x1.svg       grid-1x1-01.svg
lamina-3-story.png           story-03.png
```

The number counts from 01 in slide order and is the same width across a delivery (three digits only past 99 slides). The pixels are unchanged. A script that reads the output folder by name must use the new names; one that reads `result.json` keeps working. Re-exporting into a folder that holds a delivery from before this change leaves the old-name files beside the new ones (TYTO-127).

`@tyto/pipeline`: `artifactName(format, number, extension)` replaces `artifactName(artwork, format, extension)`, and `artworkNumber(index, count)` is exported.
