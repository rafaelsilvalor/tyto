---
'@tyto/editor': minor
---

TYTO-442: vim's yank can share the system clipboard. `setVimSystemClipboard(port)` takes a `SystemClipboard` (`readText`, `writeText`) for every editor of the window: an unnamed yank (`yiw`, `yy`) is written to it, and when an editor takes focus a clipboard that changed since Tyto last wrote or read it goes into the unnamed register and `+`, so `p`, `.`, visual `p` and `gr` paste it. Named yanks do not write, and `"+y` stays the engine's own write. Off until a host passes a port. `VimYank` gains `register` (`unnamed`, `named` or `clipboard`).
