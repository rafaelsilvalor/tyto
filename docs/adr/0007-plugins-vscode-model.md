# 0007 — Plugins with manifest, permissions and isolation (VS Code model)

Status: accepted · 2026-09-05

## Context
Vim-like extensibility is desired, but credentials may transit through the host.

## Decision
Fixed extension points, `tyto-plugin.json` with permissions, utilityProcess per plugin, host as proxy. Built-ins use the same API.

## Consequences
API validated by internal use before opening. A plugin cannot run arbitrary code with full access.
