---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/template-kit': minor
---

A template spaces its blocks by weight and keeps orphans off its text (ADR 0167, TYTO-516).
`@tyto/template-kit` gains `spaceByWeight`, which shares the room between two edges out by
weight so the gaps scale together and equal outer weights centre the blocks, and `settle`,
which clears a paragraph's last line of one word with letter spacing and then a smaller size
within the template's limits. What it cannot clear, `reportOrphan` reports as the new
`W_TEMPLATE_ORPHAN` warning, which `@tyto/core` adds to the closed list a template may report.
The report carries the word, so the plugin RPC protocol is 14.
