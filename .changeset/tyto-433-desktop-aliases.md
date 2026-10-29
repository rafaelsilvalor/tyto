---
'@tyto/desktop': minor
---

TYTO-433: the desktop resolves the plugin files' configurations and aliases (ADR 0151). A brief that names an alias previews and exports as its template with that configuration's values, as `tyto render` does; an alias named like a template that loaded is refused with `E_TEMPLATE_ALIAS_TAKEN` at its place in the plugin file. `templates:list` lists each alias as a row of its own, carrying `alias: { template, configuration }`, so the template picker, the "/" menu and "New brief from template" offer it. A sync that only edited a plugin file tells the window too. The permission box is `approveInABox`, a function around Electron's dialog.
