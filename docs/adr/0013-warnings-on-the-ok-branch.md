# 0013 — Warnings travel on the Ok branch of Result

Status: accepted · 2026-09-05 · extended by ADR 0025, which renamed the field

## Context

`CLAUDE.md` fixes the stage signature at `Result<T, Diagnostic[]>`, and the catalog already contains warnings: `W_TEXT_OVERFLOW` is emitted by compile, which still produces a `Scene`, and `W_UNUSED_SLOT` by resolve, which still produces a `ResolvedBrief`. With diagnostics only on the failure branch, a warning would have to either fail the stage or be discarded, and `result.json` promises a `diagnostics[]` alongside a successful `status: ok`.

## Decision

`Ok<T>` carries `warnings: readonly Diagnostic[]` in addition to `value`. The stage signature is unchanged — failure is still `Diagnostic[]` — so the rule in `CLAUDE.md` holds as written. `andThen` and `all` concatenate warnings across steps; `fromDiagnostics` splits a mixed list, failing when any item has severity `error` and otherwise passing the whole list through as warnings.

A failed batch drops the warnings of the successes inside it: there is no value left for them to describe.

## Amended by ADR 0025

The field below is called `diagnostics`, not `warnings`, since 2026-09-17: a stage may now
put a non-fatal **error** on the ok branch beside the part of its value that survived, so a
name that said "warnings" would make every reader of that branch wonder whether an error in
it was a bug. Everything else here stands — warnings still ride along, `andThen` and `all`
still accumulate, and `fromDiagnostics` still means exactly what it meant.

## Consequences

Every `ok(value)` gets an empty warning list by default, so call sites stay short. Anything that consumes a `Result` must decide whether to surface warnings; the CLI and `result.json` do, and a stage that ignores them loses information silently — which is why `andThen` accumulates rather than replaces.
