---
'@tyto/plugin-api': minor
'@tyto/core': minor
---

A list setting can be checked one entry at a time (TYTO-301, ADR 0091). A `configuration`
contribution may declare `entries: { schema, unique }`; then an entry the schema refuses, or one
that repeats an earlier entry when `unique` is set, is left out and reported as the new warning
`W_SETTING_ENTRY_INVALID` at that entry, and the rest of the list still applies. `SettingEntry`
gains `entryRanges`, so a reader can say where each entry of a list was written. Both are
optional: every existing setting and reader behaves as before.
