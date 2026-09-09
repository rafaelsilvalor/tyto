---
'@tyto/export-html': patch
'@tyto/export-svg': patch
---

Draw an image paint in the node's own box (TYTO-28)

Both exporters wrote an image paint's `<pattern>` in `objectBoundingBox` units, where the
image's viewport is the unit **square**: `preserveAspectRatio` fitted the picture to a
square, and the square was then stretched to the node's box. On anything that is not
square the aspect ratio was destroyed — a `cover` image on a 1080×1920 frame came out with
a circle rendered as an ellipse.

Both now write the pattern in user space with the node's real box, which is what makes
`cover` mean cover.

Found by rendering the same scene through both exporters in Chrome and counting pixels:
**972151 of 2073600 differed** on the story frame, and **0** do now. The two remaining
differences between the exporters are the documented ones — text placement (ADR 0019) and
stroke alignment (ADR 0018).
