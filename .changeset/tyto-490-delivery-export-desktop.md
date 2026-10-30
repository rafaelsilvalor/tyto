---
'@tyto/desktop': minor
---

A button beside **Open preview to the side** exports the delivery the brief in front belongs to, with no dialog to fill (TYTO-490, ADR 0157 §6). The export box opens already running. The artwork goes to the delivery's root (its `exports` folder), and `result.json` and `template.txt` go beside the brief. For a brief in no delivery the button is greyed, with a tooltip saying why. The command is **Delivery: Export** (`delivery.export`), bindable in `keybindings.json`.
