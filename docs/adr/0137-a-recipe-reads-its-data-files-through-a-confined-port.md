# 0137 — A recipe reads its data files through a confined port

Status: accepted · 2026-10-24 · TYTO-395 · builds on ADR 0136, ADR 0111, ADR 0112, ADR 0128,
ADR 0130 and ADR 0133.

## Context

ADR 0136 put company rules in a JSON file beside the recipe, named from a verb argument as
`@./file.json#/pointer` and read "through `resolveData`". It did not say what the reference
grammar is, what the host returns, which folder a path is relative to, how large a file may be,
or what a restricted workspace answers. `@tyto/recipe` is pure, so it cannot read a file; the
`run` verb already reaches other recipes through a host port (`resolveRecipe`, ADR 0133), and
this is its sibling. No app runs recipes yet (the notebook is TYTO-377), so the port and a
reusable adapter come first and the wiring comes with the app that runs them.

## Decision

1. **The reference is `@<path>#<pointer>`; `@<path>` alone is the whole document.** The path
   is relative: an absolute path, a drive letter or a URL scheme is refused in `@tyto/recipe`
   before any host is asked. The pointer is RFC 6901 in its JSON-string form (`~0`, `~1`); the
   URI-fragment form's percent-encoding is not decoded. An array index is decimal without
   leading zeros, `-` reaches nothing, and an object key is an own key, so `/__proto__` never
   names something every object inherits.
2. **The port is `resolveData(path) → Result<unknown, Diagnostic[]>`**, optional in
   `RunOptions` and `VerbContext`, and passed on by `run` to the recipe it includes. The host
   reads and **parses**; the recipe receives a value and never text. A host without a
   workspace omits it, and a verb that needs data then reports that it has none. `@tyto/io`
   names the port's type through `@tyto/plugin-api`, as every adapter implements a port from
   `core` or `plugin-api`.
3. **`readDataArgument(context, argument, schema)` is the one helper a verb calls.** It
   parses the reference, asks the host, walks the pointer and validates the slice with the Zod
   schema the verb supplies. Every refusal is a diagnostic at the argument's range, including
   the host's, whose own ranges would point into the data file and are dropped. Four codes:
   `E_RECIPE_DATA` (malformed reference, missing, outside the workspace, too large, no host),
   `E_RECIPE_DATA_RESTRICTED`, `E_RECIPE_DATA_SYNTAX` (with the line and column in the data
   file in its message) and `E_RECIPE_DATA_SHAPE` (a pointer that reaches nothing, a slice the
   schema refuses).
4. **The workspace adapter is `workspaceDataResolver` in `@tyto/io`.** A path resolves
   against the folder of the recipe being run and must stay inside the workspace folder:
   checked lexically with `core`'s `resolvePath`/`isInsidePath`, then again after `realpath`
   with `isInside`, the two halves of ADR 0112. A restricted workspace reads no data file at
   all (ADR 0136 decision 2): the refusal comes before the path is looked at.
5. **A data file holds at most 1 MiB**, checked on `stat` and again on the bytes read. A
   vocabulary of a few thousand entries is tens of kilobytes; the whole file is parsed to
   reach any slice of it.
6. **The text is JSON with comments**, read by `readJsoncValue` beside the JSONC reader the
   project and settings files use (TYTO-350), with the same options and BOM handling. An empty
   file is a syntax error, not `undefined`.

## Consequences

- A rules verb (ADR 0136 decision 1) is a schema and a call; it never parses a path or a file.
- A recipe included with `run` reads data relative to the folder the host's adapter was made
  for, not its own: the port knows one folder. A recipe that is both included and reads
  relative data should name paths from the workspace's recipe folder until a host needs more.
- The adapter is not wired into the desktop or the CLI. TYTO-377 composes it in the desktop
  from `loadWorkspace`'s `folder` and `trust`; a CLI recipe runner is a card of its own.
