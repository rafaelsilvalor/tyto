# @tyto/brief-lang

## 0.1.0

### Minor Changes

- 01d9b27: Add the Lezer grammar for the brief language: frontmatter, `::name` and `::ns/name` directives with an inline or indented body, `{a, b: value}` adjustments, inline markup (`**bold**`, `*italic*`, `\` break, `{k:v}…{/}` marks), `//` comments and the `\::` escape. `parser` and `briefHighlighting` are exported, so the compiler and the editor read the same tree and cannot disagree about what a brief means.

  The grammar is built from `brief.grammar` by `generate:parser`, which `build`, `typecheck` and `test` all depend on; the generated parser is build output and is not committed.

  A corpus of 23 fixtures pins the behaviour — 17 that must parse with no error node, 6 that must not, each asserting where the error actually lands. Recovery keeps parsing past the damage, so a half-typed brief still highlights.
