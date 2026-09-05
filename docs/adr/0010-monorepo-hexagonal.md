# 0010 — pnpm monorepo with a pure/Node/DOM boundary

Status: accepted · 2026-09-05

## Context

The same core must run on desktop, CLI and cloud.

## Decision

Pure packages without Node/DOM imports; adapters in their own packages; composition only in apps. A lint rule forbids cross imports.

## Consequences

Portability guaranteed by lint, not by discipline.
