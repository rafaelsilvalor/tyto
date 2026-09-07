---
'@tyto/brief-lang': minor
'@tyto/core': minor
---

Add `parseBrief`, which turns the Lezer tree into a typed `BriefAst`.

`brief-lang` now exports `parseBrief(text): Result<BriefAst, Diagnostic[]>` and the AST
types (`BriefAst`, `Directive`, `Adjustment`, `Inline` and its members). Frontmatter is
parsed with `yaml`; syntax errors and invalid frontmatter come back as `E_SYNTAX`
diagnostics with a range, one per position.

`core` gains the `E_SYNTAX` code, which the parse stage needed and the catalog did not
have.
