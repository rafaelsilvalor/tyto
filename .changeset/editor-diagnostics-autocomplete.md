---
'@tyto/editor': minor
---

Inline diagnostics and manifest-driven autocomplete (TYTO-37).

`briefLint(analyzer)` turns every `Diagnostic` `parse` and `resolve` produce into a
CodeMirror lint marker — same code, same message, same span, because a `SourceRange` is
already the pair of UTF-16 offsets CodeMirror consumes and nothing is converted on the way
in. A diagnostic whose range covers exactly a name carries a quick fix built from
`didYouMean` in `core`, the same function and budget that produced the message's own hint,
so the button and the message can never name different slots.

`briefCompletion()` reads the manifest the frontmatter named and offers slot names after
`::`, adjustment names inside `{}` filtered by their `applies`, enum values after `:`, and
format ids in the frontmatter list. Nothing is hard-coded: change `template:` and every
list in the file changes with it.

Both are fed by one `BriefAnalyzer`, the port the host fills. `createBriefAnalyzer` runs
the two stages in process; `createWorkerAnalyzer` and `serveBriefAnalysis` are the two
halves of a worker protocol for a host that would rather not parse a twelve-slide brief on
the thread that paints the caret. The package constructs no worker — that is the bundler's
business and therefore the host's.

Two diagnostics deliberately never reach the gutter: `W_TEXT_OVERFLOW`, because the editor
does not `compile` and compiling executes a third party's template, and
`E_ASSET_NOT_FOUND`, unless the host passes an `AssetResolver` — a renderer cannot see a
disk, and underlining every image path in a brief that renders fine from the CLI would
teach an author to ignore the gutter.
