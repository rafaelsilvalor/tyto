# 0004 — Brief syntax: :: directives + YAML frontmatter

Status: accepted · 2026-09-05

## Context

Copywriters/designers must write fast; slots map 1:1 to templates; inline Markdown in text.

## Decision

`::slot` directives, `{…}` adjustments, frontmatter for metadata. Custom Lezer grammar.

## Consequences

Trivial highlighting and autocomplete in CodeMirror; validation against the manifest. Plain Markdown rejected for slot ambiguity.
