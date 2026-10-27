---
'@tyto/plugin-api': minor
---

TYTO-428: every recipe verb call — `page`, `transform` and `plan` — carries `section`, the verb's own plugin's section of the folder's `.tyto/project.json`, absent when the folder has none or is restricted (ADR 0147). `recipeRegistriesOf(contributions, { sectionOf, limits, planLimits })` asks `sectionOf(plugin)` on every call and hands a verb only its own plugin's section; it takes an options object where it took two positional limits. `PluginRegistry.ownedRecipeVerbs()` lists each verb with its plugin. The isolation protocol is 8: a plugin process on 7 is refused at `hello`.
