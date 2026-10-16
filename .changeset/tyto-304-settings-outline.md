---
'@tyto/plugin-api': minor
---

TYTO-304: a setting may say what each of its values does. `ConfigurationContribution` gains an
optional `options: { value, description }[]`, and `entries` and `members` gain one each; they
are help for the settings tab and never a rule, and an option the setting's own schema refuses
makes the declaration throw. `outlineOf(declared)` reads every declared schema once with Zod's
`z.toJSONSchema` and answers plain data — description, type in words, default as JSON and the
accepted values — which is what the desktop sends to its settings tab (ADR 0092).
