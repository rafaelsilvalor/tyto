---
'@tyto/template-kit': minor
---

The text pieces take an area and a parameter schema (TYTO-891): `textIn`, `grownTextIn`, `titleBlockIn` and `levelStackIn` with `TEXT_PARAMETERS`, `GROWN_TEXT_PARAMETERS`, `TITLE_BLOCK_PARAMETERS` and `LEVEL_STACK_PARAMETERS`, returning their overflow and an anchor at their capitals; `titleBlockIn` takes `measureFrom: 'capitals'`. `textBlock`, `grownTextBlock`, `titleBlock` and `levelStack` draw the same bytes as before.
