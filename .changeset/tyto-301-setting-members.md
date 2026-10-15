---
'@tyto/plugin-api': minor
'@tyto/core': minor
---

An object setting can be checked one member at a time (TYTO-301, ADR 0091). A `configuration`
contribution may declare `members: { key, schema }`; then a member whose name `key` refuses is
`W_SETTING_ENTRY_INVALID` at the name, one whose value `schema` refuses is `W_SETTING_INVALID` at
the value under the dotted key, either is left out, and the rest still apply. `SettingEntry` gains
`memberRanges`. Both are optional. `@tyto/core` adds the warning `W_SETTING_LOW_CONTRAST`, for a
colour setting that applies although the text it leaves reads under 4.5:1.
