# 0008 — Local queue as a folder contract

Status: accepted · 2026-09-05

## Context

The app is local; remote queues are handled elsewhere (see ADR 0011).

## Decision

`BriefSource`/`OutputSink` ports; fs-inbox/fs-outbox adapters; a local watcher; never ack on error.

## Consequences

Everything is testable locally. Remote adapters remain possible later without changing the contract.
