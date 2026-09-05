# 0003 — The brief compiles to a Scene IR, not to HTML

Status: accepted · 2026-09-05

## Context

PNG and SVG from day one; the editor needs a layer concept; PDF/video later.

## Decision

A Zod-defined scene tree is the single source of truth. Exporters are visitors over it. Templates produce IR.

## Consequences

One more layer of code. In exchange: coherent outputs, undo, per-layer preview, new backends without touching the compiler.
