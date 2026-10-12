---
'@tyto/editor': minor
---

TYTO-256: `withDiagnostics(state, diagnostics)` and `EditorHandle.showDiagnostics(diagnostics)` put a host's diagnostics on a document as lint markers, in any language — a `plain` buffer with no linter of its own included — replacing the ones it had; they map through later edits and stay off the undo history. They take `MarkedDiagnostic`, the five fields a marker needs, which a Tyto `Diagnostic` satisfies.
