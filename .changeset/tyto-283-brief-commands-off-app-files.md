---
'@tyto/desktop': patch
---

TYTO-283: with `settings.json` or `keybindings.json` in front, the commands that act on a brief — Export, the preview's zoom, format and slide steps — are no longer offered in the command bar, do nothing on a key bound to them, and are greyed in the File menu and the status bar. Before, Export opened its dialog there and wrote the JSON out as `editaveis/settings.json.brief` beside a `result.json` of syntax errors.
