---
'@tyto/desktop': minor
---

TYTO-366: clicking a `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` or `.svg` in the explorer shows it in the preview, with its name, its size in pixels and its size on disk in the preview's bar. Zoom, Fit and Lock work as for a brief, and the explorer keeps the focus. Bringing a brief to the front makes the preview follow it again. An image over 32 MB, a file whose contents are not the image its name says, and an image deleted while shown each get a line saying so. An SVG is shown as a picture: its scripts do not run and it loads nothing.
