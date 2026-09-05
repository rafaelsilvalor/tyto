# 0005 — Templates in HTML-like markup + optional TS, with a declarative manifest

Status: accepted · 2026-09-05

## Context

Designers (assisted by AI agents) author templates; plain TS is a barrier; declarative YAML becomes an accidental layout language.

## Decision

YAML manifest (slots/adjustments/formats) + `template.html` where tags = IR nodes and CSS is restricted; `template.ts` as the alternative. Both produce Scene.

## Consequences

Human- and LLM-friendly format; validation before execution; faithful SVG because it is not real HTML.
