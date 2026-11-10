---
'@tyto/desktop': minor
---

TYTO-660: a plugin's panel page hears more about the document in front and the window's
language. The `document` event now carries the tab's `name` and the `format` the preview
shows, and is also sent when another tab or format comes to the front; a new `language` event
is sent when a panel loads and whenever the window's language changes. Both are additive.
