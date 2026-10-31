---
'@tyto/core': minor
'@tyto/editor': patch
---

A slide places several pictures where its body says (TYTO-498, ADR 0160 amended 2026-10-31). A manifest may declare `multiple: true` on a `per` image slot; then each `::imagem` after the same `::lamina` adds a picture, its first line is the path, and the indented lines under it continue the slide's body. The slide's value carries `blocks`, its body in order with the pictures among the text; `value` and the slot under its own name are unchanged, so a brief and a template written for one picture per slide render the same. The editor marks such a slot `multiple` when it completes `::`, and the manual's carousel page says how to write it.
