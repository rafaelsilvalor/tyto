---
'@tyto/io': minor
---

TYTO-46 — the render contract, published.

`@tyto/io` gains `EXIT_OK`, `EXIT_DIAGNOSTICS`, `EXIT_INTERNAL` and `EXIT_CODES`. They were
in `apps/cli`, and moved here because they are the other half of the ADR 0011 contract this
package already owns: `result.json`'s schema lives in `result.ts`, and the exit code a
caller reads is the same promise made to the same reader. A document generated from the code
cannot import an app, and two copies of "1 means error diagnostics" is two places for it to
stop being true. `apps/cli/src/exit.ts` re-exports them, so every command still reads them
from one import.

Two generated artefacts ship with it, neither of them in this package:
`docs/render-contract.md` and `docs/render-result.schema.json`, both written by
`pnpm docs:gen` and checked for drift by `pnpm check`.
