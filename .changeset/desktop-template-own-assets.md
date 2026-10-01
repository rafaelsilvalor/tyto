---
'@tyto/desktop': patch
---

TYTO-176: a markup template that draws from its own folder (`<vector src="assets/…">`,
`<image src="assets/…">`) renders in the window's preview and export, as it does in
`tyto render`. Before, the window reported `E_TEMPLATE_MARKUP` or `E_TEMPLATE_VALUE` and drew
nothing.
