---
'@tyto/plugin-api': minor
---

TYTO-272: the `members` rule of an object setting takes `schemaByName`, a schema per member name used instead of `schema` for that member, so one object can hold members with different bounds — a size per area where each area has its own largest size. A member its own schema refuses is still `W_SETTING_INVALID` at that value, and the others apply.
