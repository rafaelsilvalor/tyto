---
'@tyto/recipe': minor
'@tyto/core': minor
---

TYTO-394 (ADR 0136): `where` can match a cell against a pattern, with `matches "<pattern>"` and `not matches "<pattern>"`. Patterns are `tyto-pattern/1`: JavaScript syntax with the flags `iu`, where `\b`, `\w` and `\d` (and `\B`, `\W`, `\D`) know every Unicode letter and digit. A guard refuses backreferences, lookaround and nested quantifiers at compile time, a pattern holds at most 512 characters, and a cell is tested on its first 4,096. `@tyto/recipe` exports `compilePattern` for the verbs that will match text next; `@tyto/core` gains `E_RECIPE_PATTERN` and `E_RECIPE_PATTERN_UNSAFE`. A recipe's `{param}` no longer catches the braces of `\p{…}`, `\P{…}` or `\u{…}`.
