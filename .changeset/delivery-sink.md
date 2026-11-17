---
'@tyto/recipe': minor
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/desktop': minor
---

`to-delivery name=<column> fields=<field>:<column>,…` keeps one delivery folder per row under the
project's `delivery.parent`, with `assets/`, `editaveis/` and its record at
`editaveis/delivery.json` (ADR 0210). It plans one operation per folder that changes, keeps a
field a person edited, plans nothing on a second run over the same rows, and names a refused row
in the cell's note. `@tyto/plugin-api` re-exports `ToDeliveryPorts`; `@tyto/io` gains
`workspaceDeliveryPorts`, which the shared recipe runner lends to every host; the window gains the
step form's Portuguese.
