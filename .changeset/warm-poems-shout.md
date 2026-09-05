---
'@tyto/core': minor
---

Add the error vocabulary the rest of the pipeline is built on: `Result` with its combinators, `Diagnostic` and the `E_*`/`W_*` catalog, and source-range helpers. Warnings travel on the success branch (ADR 0013). `docs/diagnostic-codes.md` is generated from the catalog by `pnpm docs:gen`.
