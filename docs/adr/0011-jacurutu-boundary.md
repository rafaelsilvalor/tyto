# 0011 — Tyto renders, Jacurutu orchestrates; boundary is a file contract

Status: accepted · 2026-09-05

## Context
The JAC board shows Jacurutu already covers the remote queue, template choice, Drive and credentials. Reimplementing that in Tyto would duplicate the suite. Jacurutu is not running yet and may change pace.

## Decision
Boundary = task folder with `brief.brief` + `assets/` in and `out/` + `result.json` out, via `tyto render`. No Tyto package imports Jacurutu or vice versa. Template chosen by Jacurutu, validated by Tyto against the manifest; no parallel catalog. E10 deferred, `RemoteBrief` contract preserved.

## Consequences
Tyto is usable and testable alone (app + CLI + fs-inbox). Jacurutu maturity blocks nothing. If Jacurutu does not cover it, sources return as medium-sized plugins without touching the core. Risk to watch: Jacurutu inventing its own template semantics.
