---
'@tyto/core': minor
'@tyto/brief-lang': minor
'@tyto/template-lang': minor
'@tyto/pipeline': minor
'@tyto/io': minor
'@tyto/editor': minor
---

TYTO-107 — a stage may produce a value and still report errors

A brief with one error anywhere used to render nothing. It now renders the slots that are
fine and reports the one that is not, because severity and fatality are two questions and
they were one field (ADR 0025).

**`Ok<T>.warnings` is `Ok<T>.diagnostics`.** It no longer holds only warnings: a non-fatal
error rides the ok branch beside the part of the value that survived. A code declares
`fatal` beside `severity` in the catalogue, `fromPartial(value, items)` is what a stage with
something partial to hand back returns, and `hasFatal` is the test. `fromDiagnostics` is
unchanged and is still right for a stage with nothing partial to offer. `withWarnings` is
`withDiagnostics`.

**Severity still decides the exit code.** A partly rendered brief is `hasErrors` and fails a
build; what changed is that it also writes its artifacts, so `result.json` is
`status: error` with a non-empty `artifacts` — the state `docs/render-contract.md` now calls
_rendered, with errors_.

**`E_SYNTAX` split three ways**, because fatality is a property of the code: `E_SYNTAX` is a
line of the brief body and is not fatal, `E_FRONTMATTER_SYNTAX` is the block that names the
template and is, and `E_TEMPLATE_SYNTAX` is a `template.html` and is. `docs/diagnostic-codes.md`
publishes the whole list with the reason for each entry.

**A failed frame no longer costs the report.** `runJob` returns its `JobReport` with the
errors riding along, so the eleven frames of twelve that rendered are listed rather than
dropped — `result.json` used to say `artifacts: []` over a folder the same run had written
nine files into.

`E_MISSING_REQUIRED_SLOT` and the unresolved-export codes stay fatal on purpose: each would
leave a hole in the artwork that nothing in the artwork names, and art that looks finished
with a slot silently empty is the failure this card had to avoid.
