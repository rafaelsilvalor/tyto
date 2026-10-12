---
'@tyto/desktop': patch
---

A page's own `window.close()` now goes through the same quit handshake as the window's X button, so the session's final write runs first: a draft typed just before it comes back on the next launch, and the settings tab's pending screen changes reach the file. A reload, whether the window or DevTools starts it, still reloads.
