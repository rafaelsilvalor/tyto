---
'@tyto/desktop': minor
---

TYTO-244 (ADR 0078): on Windows and Linux the window draws its own title bar — "Tyto — <file>" for the tab in front, "Tyto" alone for an untitled one — in place of the system's title bar and the old header with the tagline, which is gone. The minimise, maximise and close buttons stay the system's, drawn over the bar's right end in the colours of the applied theme, and they follow a theme change, the picker's preview and the system's light/dark switch. macOS keeps its native frame. Until the drawn menu row lands, the File/Edit/View/Window/Help menu bar is not shown on Windows and Linux.
