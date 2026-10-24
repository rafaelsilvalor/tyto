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
