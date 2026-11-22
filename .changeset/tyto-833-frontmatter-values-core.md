---
'@tyto/core': minor
---

TYTO-833: a brief's frontmatter sets the values its template declares (ADR 0226), by name, over a
plugin file's configuration and the manifest's defaults: `destaque: '#e30613'`. A slot of the
same name stays the slot; an image value is refused with `W_TEMPLATE_VALUE_INVALID` (a
configuration sets it). An empty colour, which is what an unquoted `#…` reaches as, says to write
the quotes.
