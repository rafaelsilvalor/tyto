# 0060 — `tyto watch`'s `out/` follows ADR 0059

Status: accepted · 2026-10-01 · TYTO-211 · amends ADR 0059's "where it does not apply"

## Context

ADR 0059 made the desktop queue remove, from `outbox/<id>/out/`, what the previous run's
`result.json` listed and the new run did not produce, and left `tyto watch` out because it
lives in `apps/cli`. It stated the difference that left: the window and `tyto watch` pointed at
one queue folder give different answers.

Measured on 2026-10-01 with the built CLI and the `cartaz` fixture: `tyto watch queue --once
--types svg` over a task of four slides, then the same id dropped again with three. `out/`
held `feed-01.svg` to `feed-04.svg` beside a `result.json` that listed three and carried no
warning.

## Decision

**`tyto watch` opens each task's `out/` with ADR 0054's rule on**, exactly as the desktop queue
does since ADR 0059. Everything those two ADRs say about what is removed, what is kept and why,
and what a reader of `out/` sees (`W_LEFTOVER_REMOVED` and `W_LEFTOVER_KEPT` warnings, `status`
unchanged) applies as written. It is the same rule through the same option on `fsTaskOutput`,
not a second deletion.

**`tyto render --out` does not change.** It is the command Jacurutu calls
(`docs/integrations.md`), and that document promises the caller that `--out` removes nothing.
`tyto watch` is a person's convenience and a simulator for the contract
(`docs/render-contract.md`), and the folder it writes is the one the queue already tidies;
`--out` is a folder its caller owns and reconciles against `result.json` itself. Reversing a
promise made to that caller needs a measured need from that side, and Jacurutu is not running.

## Consequences

The window and `tyto watch` over one queue folder now agree: a task re-sent with fewer slides
ends with the slides it has now, and its `result.json` names what went.

The cost, declared: **`tyto render --out` into an `out/` it wrote before still keeps the
leftovers**, so the same brief rendered by hand into a reused folder and by `tyto watch` can
end with different folders. Both `result.json` files list the same artwork.
