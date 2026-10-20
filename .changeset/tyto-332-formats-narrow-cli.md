---
'@tyto/cli': minor
---

`--formats` on `tyto render` and `tyto watch` now narrows the brief's `formats:` line instead of being ignored when the brief has one (TYTO-332, ADR 0107). A size the flag names that the line does not have is `E_FORMAT_NOT_IN_BRIEF`, so `watch --formats story` on a brief that does not list `story` now reports an error where it used to render the brief's formats.
