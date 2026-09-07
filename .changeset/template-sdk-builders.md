---
'@tyto/core': minor
---

Add the template SDK at `@tyto/core/template`: `frame`, `group`, `rect`, `text`, `image` and `vector`, plus the values that feed them — `color`, `solid`, `linearGradient`, `radialGradient`, `imagePaint`, `stop`, `font` and `run`. A template writes what differs and the builders fill the rest with the IR defaults, so a bare rect still carries an identity transform, opacity 1, blend normal and an empty effect list.

The six node builders return drafts; `frame()` turns them into IR by assigning every id a template left out, derived from the node's position (`feed.0`, `copy.0`) so it is stable across runs. A frame only sees its own subtree, so `idPrefix` is how an assembler keeps ids unique across artworks.

Misuse is a type error where a type can hold it: a text without runs and a gradient with fewer than two stops do not compile. A hex string's contents cannot be checked by a type, so `color('#gggggg')` throws a `TemplateError` carrying a ready `E_TEMPLATE_VALUE` diagnostic — a bad colour literal is a bug in code, not something a brief author can cause.
