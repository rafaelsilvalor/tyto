---
'@tyto/desktop': minor
---

TYTO-272: two new settings give each part of the window its own text size and face, over the two bases, applied on save with no restart. `fontSizes` and `fontFamilies` take a closed set of areas — `editor`, `json` (the settings, keybindings and snippets tabs) and `completion` over the code base, and `problems`, `commandBar`, `titleBar` (up to 18), `tabs`, `paneHeaders`, `statusBar`, `queue` and `explorer` (once there is one) over the UI base. An area left out follows its base, so changing the base still moves it. An unknown area or a size outside that area's bounds is a warning at that entry and the rest apply. A face the machine lacks is `W_FONT_FAMILY_MISSING` naming the area. The tab strips grow so a larger tab is never cut; the brief's editor and a settings tab beside it can be different sizes. A new `settings.json` lists every area under both keys, commented out. At the defaults the window is pixel for pixel what it was.
