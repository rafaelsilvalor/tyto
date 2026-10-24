# 0133 — `join` pairs rows on a column a derivation produces

Status: accepted · 2026-10-24 · TYTO-375 · amends ADR 0128; builds on ADR 0127.

## Context

ADR 0128 put `join`, `derive` and `run` in the generic vocabulary and left their shape to the
card that ports them. Buraqueira's `flow.py` is the model, and its `join` is not generic as
written: it builds the pairing key itself, from the issue summary, with three strategies
chosen by the left row's kind (an ad by format and concept, an organic post by its date,
anything else by its deliverable), a list of formats and team labels from the company's
config, and a fourth outcome, "sem par (natureza)", for kinds that never get a copy. Every one
of those is the company's naming, and ADR 0127 keeps a provider's or a company's rules out of
Tyto, which is a public repository.

What is generic in it is the pairing: one table, a left side that tries, a right side that is
consumed, a key per row, and the rule that a key answering to two rows pairs with neither.

## Decision

1. **`join <prefix> left="<where>" right="<where>" on=<column> [bring=key,status]`.** Both
   sides are drawn from the current table with the `where` grammar; a row on the right side is
   never on the left. `bring` defaults to `key,status`, as in `flow.py`.
2. **The key is a column**, usually one a derivation produced. Keys compare the way `where`
   values do, without case, accents or surrounding blanks. An empty cell offers no key.
3. **A list value is several keys.** A right row is indexed under each key in its list, and a
   left row looks under each of its own. This is how a derivation keeps `flow.py`'s several
   strategies: it gives each right row one key per strategy and each left row the key of the
   strategy that applies to it. Candidates are counted as distinct right rows.
4. **The right side is consumed.** Its rows leave the table; the columns `bring` names reach the
   left row they pair with as `<prefix>_<column>`, with the brought column's type. Otherwise a
   paired copy row would appear twice, once on its own and once inside its design row. A left
   row keeps its own provenance; a right row's provenance does not ride, so a later write that
   needs the right row brings its `key`.
5. **`<prefix>_match` says how the row paired**: `paired`, `ambiguous (N candidates)`, `no key`
   or `no pair`. **An ambiguous key never pairs**: its brought columns stay empty. A row on
   neither side passes through with every new column empty.
6. **Ambiguity is reported once per cell**, as `W_RECIPE_JOIN_AMBIGUOUS` at the `join` line,
   naming up to eight rows. The rows already say it in `<prefix>_match`; the warning exists so
   that one ambiguous row among a hundred is seen, as `flow.py`'s log line did. A warning per
   row would repeat the column.
7. **A prefix whose columns already exist is refused**, so a second `join` never overwrites
   the first in silence.
8. **`derive <name>…` runs registered derivations in order, and may await them.** A
   derivation declares the columns it `requires` and the columns it `produces`, and its
   `derive` function returns the whole table, synchronously or as a promise: a derivation a
   plugin contributes is a call into another process (TYTO-376), exactly like a verb. A name
   nobody registered, or a required column the table lacks, is `E_RECIPE_DERIVATION` at that
   name, listing what is registered or what the table has. After the call, a promised column
   that is missing, or a row that came, went or moved, is the same error: a derivation adds
   columns, and one that filtered rows would be a `where` nobody can read in the recipe. Tyto
   registers no derivation.
9. **`run <recipe> [name=value…]` includes a recipe at its line**, the way `flow.py`'s
   `_expandir_run` spliced one into the chain: the included recipe reads this cell's input,
   and the next line reads what it produced, its `keep`s and its last `show` included. It is
   **one cell**, not the included lines copied in, because a cell's diagnostics point into the
   file being edited and the included lines live in another; a diagnostic from inside is moved
   to the `run` line and its hint names the recipe. The recipe is found through the
   `resolveRecipe(name)` port, so the package stays pure. A parameter the recipe does not
   declare is `E_RECIPE_PARAM` listing the ones it does. A recipe that would include one
   already running, by the name asked for or by the name in its header, is `E_RECIPE_RUN`,
   showing the chain, before it is read a second time.
10. **The company's key-building stays out.** Summary parsing, formats, team labels and "no
    pair by nature" are derivations and rules of the private plugin (TYTO-391). Tyto's tests
    use an invented derivation over an invented campaign.

## Consequences

- A team's pairing rules change in its plugin; the `join` line in a shared recipe does not.
- "No pair by nature" is not a `join` outcome. A derivation can produce a column that says a
  kind never pairs, and a `where` reads it; parity with `flow.py` on this decides in TYTO-391.
- The notebook (TYTO-377) shows a `run` as one cell. Showing the included recipe's own cells
  under it would need the cell to carry them; nothing does yet.
- Named tables remain out (ADR 0128): `join` is still a self-join over the one table.
