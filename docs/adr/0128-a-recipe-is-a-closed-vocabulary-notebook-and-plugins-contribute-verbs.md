# 0128 — A recipe is a closed-vocabulary notebook, and plugins contribute verbs

Status: accepted · 2026-10-24 · TYTO-368 · builds on ADR 0007, ADR 0079 and ADR 0127 · amended by ADR 0133
and ADR 0136.
Reasoning in `docs/explorations/2026-10-24-data-recipes-and-connectors.md`

## Context

The maintainer wants to work on data pulled from Jira "in a Jupyter style": step by step,
easy to write, easy to share with the design team. Buraqueira's `flow.py` already does the
work with a closed chain of verbs over one table (`pull`, `derive`, `where`, `join`, `select`,
`show`, `save`, `run`), frozen as a parameterised recipe at its second format version.

Real Jupyter was weighed and rejected for this team: a shared notebook runs its author's code
with the reader's tokens, every machine needs a Python runtime, and outputs stored inside the
file make diffs unreadable.

## Decision

1. **A recipe is a text file, `*.recipe`, one verb per line.** A header names it and describes
   it; `param` lines declare what varies. The person edits it in Tyto's editor.
2. **Every line is a cell, and the chain is linear.** Cell N reads cell N−1's table. The
   notebook view shows each cell's table, or its diagnostics, under it, and runs one cell or
   all of them.
3. **The vocabulary is closed.** Tyto ships the generic verbs (`param`, `run`, `where`,
   `select`, `join`, `sort`, `derive`, `show`, `keep`), in a pure package with no Node or DOM
   import. Plugins contribute **namespaced** verbs (`jira.pull`) of four kinds — source,
   transform, action, sink — and derivations for `derive`. A verb nobody contributes is a
   diagnostic at its line, with a range.
4. **One table type passes between verbs**, plain JSON. Column names are English and are the
   contract; values are the source's. Every row keeps its provenance (source, id, fetched at).
5. **A source pages.** A call into a plugin has a 30 s deadline (ADR 0042), so a source returns
   a page and a cursor and the host loops. A result cut short by the source's own limit is an
   error, never a partial table.
6. **Results never live in the recipe file.** A cell's table goes in the cache; `keep` writes a
   table into the workspace on purpose (ADR 0130).
7. **`to-brief` is Tyto's own sink**: each row becomes a `.brief` in a chosen template.
8. **Views are chosen by `show` and never decide rows or columns.** Table is the first; board,
   summary, calendar and loose cards are later cards.

## Consequences

- Receiving a colleague's recipe is safe in a way that receiving code is not: it can do only
  what installed verbs allow, and every write plans first (ADR 0129).
- `flow.py`'s recipes port line for line; aliases stay input-only, and `join` never pairs an
  ambiguous key.
- The vocabulary will run out somewhere. A sandboxed expression verb or a code cell needs its
  own ADR; this one does not forbid it.
- Named tables (two pulls joined) are not in v1. Buraqueira's parity needs them for one step,
  and they make the chain a graph.

## Note, 2026-11-12 — a written column may be named in quotes (TYTO-674)

Decision 4 makes column names the contract, and a sink that syncs a sheet matches columns to
the sheet's headers by name. Those headers are written for people (`Última Sync`), and every
generic verb that writes a column read its name as a bare word of letters, digits, `-` and
`_`, so such a column could never be written. A column a line writes or picks may now be
named in double quotes: `into="Última Sync"`, the name side of `compose "Última
Sync"={due|slug}`, and the members of a column list, `select key, "Última Sync"` or
`without=key,"Última Sync"`. A quoted name may hold letters of any script, digits, single
blanks between words, punctuation and symbols; never a double quote or a line break, since a
line has no quote escape, nor a comma, since a list splits at it, nor a blank at either end.
`isWritableColumnName` in `@tyto/recipe` holds the rule. A bare name keeps the old rule and
its old diagnostics. Names still compare without case, so `"ÚLTIMA SYNC"` is the column
`Última Sync`, and two names that differ only in case are still one column or a clash. No
`rename` verb and no `select … as`: the column is written under the sheet's name from the
start. The form library (ADR 0176) quotes a single column that would not read back bare, and
keeps a list's quoted members, so `formatStep` and `valuesOfStep` round-trip these lines.
`where` expressions still name columns bare.

## Note, 2026-11-14 (TYTO-727)

ADR 0199 adds a `const` header line, a value written in the recipe that nothing outside it
overrides, and `set`, a generic verb that keeps one value computed from the table for the steps
below it. Decision 1's `param` lines now share one set of names with both; the vocabulary stays
closed.
