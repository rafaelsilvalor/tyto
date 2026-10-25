---
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/plugin-api': patch
---

TYTO-397 (ADR 0136): three more generic recipe verbs driven by configuration. `extract <column> pattern=<pattern> [into=<columns>|into=<prefix>*]` writes one text column per named group of a `tyto-pattern/1` pattern, `null` where it does not match. `rewrite <column> into=<column> using=<list>` applies an ordered list of `{ pattern, replace }` steps, each to every match, where `replace` puts a named group back with `$<name>` and writes a dollar as `$$`. `urls into=<column> from=a,b host=<hosts> [first]` gathers the links on the hosts named from text and list cells, the first column before the second, cut at a Markdown or HTML wrapper and without a trailing full stop or comma, each once; `first` writes a link column with the first one. Patterns, lists and hosts may be data references. `@tyto/core` gains `E_RECIPE_REWRITE`.
