---
'@tyto/editor': minor
---

TYTO-304: `jsonAssist(source)` gives a JSON-with-comments tab a completion list and hover help
from a host's plain answers — what can go at this position, and what the text under the pointer
is — with a pick replacing the whole string being typed and leaving what the host asks for
selected. The editor still knows nothing of what a file means. `EditorHandle.blank` takes a
third argument, one document's own extensions, which a follower in another pane carries too.
