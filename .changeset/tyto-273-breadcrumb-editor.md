---
'@tyto/editor': minor
---

TYTO-273: `breadcrumbOf(state)` and `breadcrumbAt(blocks, pos, slice)` name the block the caret is in — a directive's label, or the frontmatter with the key on or above the caret's line — read off the list of `blocksOf`; nothing between blocks, after a block's last text line or on a comment. `directiveLabel` names a directive block as `::lamina 2` wherever it is listed.
