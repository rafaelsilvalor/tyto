# 0009 — Files for storage; a database only in the cloud

Status: accepted · 2026-09-05

## Context

Local-first, git-friendly, no server.

## Decision

Briefs, templates, assets and config are files. A SQLite index/cache only if measured as necessary. The cloud introduces a database through an adapter.

## Consequences

Everything is versionable. No migrations now.
