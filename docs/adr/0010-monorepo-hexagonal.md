# 0010 — pnpm monorepo with a pure/Node/DOM boundary

Status: accepted · 2026-09-05

## Context

The same core must run on desktop, CLI and cloud.

## Decision

Pure packages without Node/DOM imports; adapters in their own packages; composition only in apps. A lint rule forbids cross imports.

A pure package may depend on a library that is pure only under a non-`node` export condition, and pinning that condition is the bundler's obligation rather than the library's. Two of the six already are: `yaml` and `fontkit` each publish one build that reaches for Node and one that does not, and the `exports` map picks between them by condition.

## Consequences

Portability guaranteed by lint, not by discipline.

"Pure" therefore means two things, enforced in two places. No Node or DOM written in the source — `eslint.config.js`, tested by `tools/repo-checks/src/runtime-boundary.test.ts`. And no Node reachable under the conditions a browser build resolves — `tools/repo-checks/src/pure-export-conditions.test.ts`, which reads the dependency manifests and walks what they resolve to. Measured there today: the `node` condition reaches `process` and `buffer` in `yaml` and `fs` in `fontkit`, and nothing under the browser conditions in any of the six.

The lint cannot see the second one, because the choice lives in a bundler config and no browser bundle exists yet (E8.1). That is why the check reads manifests rather than source, and why it was written before the config it protects.
