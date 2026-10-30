---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/io': minor
'@tyto/template-kit': minor
---

A template knows an image's width and height (TYTO-481, ADR 0158). `AssetRef` gains an optional `size: { w, h }`, read by the host off the header of a brief's image, a plugin-served image or a file in the template's own folder, and absent when no header parsed. `imageHeight(asset, width, fallback)` in `@tyto/template-kit` sizes a frame to it, so a frame follows the picture without a proportion written on the slide. **Breaking for plugins: the protocol is 13** (ADR 0149 point 4), because a guest on 12 refuses a ref that carries `size`.
