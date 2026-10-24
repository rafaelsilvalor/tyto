# 0130 — A plugin gets a private cache and host-mediated workspace files, never raw fs

Status: accepted · 2026-10-24 · TYTO-368 · builds on ADR 0009, ADR 0049, ADR 0111, ADR 0112
and ADR 0117

## Context

An installed plugin may read only its own folder and cannot write anywhere (ADR 0049). The
connectors need two kinds of storage, chosen with the maintainer on 2026-10-24:

- **raw answers** from Jira and Google, which are big, change by the minute and should not be
  versioned;
- **recipes and the tables a person decides to keep**, which belong to the project, in the
  explorer, versioned and shared.

ADR 0117 already gives asset and font sources a host-managed cache, and that kind of cache is
the precedent.

## Decision

1. **A private cache per plugin**, kept by the host outside every workspace, keyed by the
   plugin and a key the plugin chooses, each entry dated. The plugin reads and writes it
   through the host; it never sees a path. The notebook shows every cached table's age, and
   "run again without the cache" bypasses it.
2. **Workspace files through the host only.** A plugin asks the host to write bytes at a path
   relative to the open workspace folder. The host confines the path as ADR 0112 confines a
   project's places (lexically, then after `realpath`), and refuses it when the workspace is
   restricted (ADR 0111). Reading the workspace works the same way.
3. **Secrets stay in the keychain** (ADR 0127), never in either store.
4. **The plugin process keeps ADR 0049's sandbox.** No `--allow-fs-write` is added; every write
   crosses the message boundary and is checked on the host's side.

## Consequences

- Clearing a plugin's cache never touches a project, and deleting a project never leaves a
  connector's data in it unless somebody kept a table.
- Every write a plugin makes into a project is one the host saw and could refuse, which is
  what lets ADR 0129's plan describe it.
- The cache has no ceiling yet. Buraqueira's `.cache/` has no expiry and lives with it; a
  ceiling is a later card if a measured cache grows.
