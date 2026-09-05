# 0006 — Editor on CodeMirror 6

Status: accepted · 2026-09-05

## Context
Custom-language highlighting, vim mode, diagnostics, runs inside Electron.

## Decision
CodeMirror 6 + Lezer + @replit/codemirror-vim. Monaco rejected (third-party vim, heavy bundle).

## Consequences
Lezer grammar shared between parser and editor. Framework-agnostic.
