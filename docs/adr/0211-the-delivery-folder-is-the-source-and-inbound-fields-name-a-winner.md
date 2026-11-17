# 0211 — The delivery folder is the source, and inbound fields name a winner

Status: accepted · 2026-11-17 · TYTO-771 · amends ADR 0210; notes ADR 0140; builds on ADR 0011,
ADR 0111, ADR 0112, ADR 0127, ADR 0136, ADR 0157 and ADR 0172

## Context

ADR 0210 gave a delivery a record, `<delivery>/editaveis/delivery.json`, written by the sink
`to-delivery`, and left open how anything reads it back. On 2026-11-17 the maintainer described
where the work now lives (translated from Portuguese):

> All information is processed and kept locally and/or in a cloud folder (Drive/OneDrive), and
> the sheets become reports.

Asked whether anyone still edits a sheet, he answered: only in some cases. A manager builds
sheets from the tracker for a third party, who may change a status there. So a sheet is mostly a
report written from the folder, and a workspace must be able to **declare a few fields that come
back from a sheet**, such as a status, and say who wins when both sides changed.

**What exists at `origin/main` 26832193, read in the code.**

- `to-delivery` writes one folder per row with its record and merges a record on disk against
  `written`, the base of what the recipe last wrote (ADR 0210 §5). `state` is refused as a field
  to map.
- No verb reads the records back as rows. `@./file.json#/pointer` feeds only arguments
  (ADR 0137).
- The status sync a recipe does today keeps its last synced values on the machine
  (`RecipeState`, ADR 0140), so a synced cloud folder cannot carry them, and the sheet is still
  the recipe's source of rows.

## Decision

### 1. `deliveries` reads the records back as rows

**`deliveries`**, a generic source with no arguments, reads every record one level under the
project's `delivery.parent`: `<parent>/<folder>/editaveis/delivery.json`. Only the project
decides where deliveries live (ADR 0157 §2, ADR 0210 §3), so it has no `from=`.

- **One row per delivery, keyed by the record's `key`.** The columns are `folder` (the folder's
  name), `path` (the folder, relative to the workspace), then `key`, `link`, `formats`, `stem`,
  `copy`, `due`, `ship` and `state`. An absent field is an empty cell.
- **`formats` comes back as text**, `feed:3,story:1`, which `to-delivery` reads back as the same
  formats. A recipe that reads the records and writes them back, through any transform that
  leaves the values alone, therefore plans nothing.
- **`written` and keys the schema does not know are not columns.** The base is the merge's
  business, not the recipe's; an unknown key stays in the file (ADR 0210 §2).
- **A record that does not read is a warning naming its folder** (`W_RECIPE_DELIVERY_RECORD`),
  and so is a folder the host may not read (a link out of the workspace) and a key a folder
  before it already gave a row; the other deliveries still read. **A folder without a record is
  not a delivery yet:** it is skipped, and the cell's note counts it.
- **It reads only in a trusted workspace**, through the ports `to-delivery` writes through
  (`ToDeliveryPorts`), which gain `list(parent)`. The adapter confines the parent and each
  folder's record after `realpath` (ADR 0112) and never lists `.tyto` or a hidden folder.
  `E_RECIPE_DELIVERIES` reports what stops the whole step.

### 2. A recipe declares inbound fields, each with its winner

`to-delivery` takes **`inbound=<field>:<winner>,…`**, or `inbound=@./file.json#/pointer`
(ADR 0136), naming the fields an outside value may change and, for each, **the side that wins
when both changed since the last run: `record` or `row`.**

- **The winner is required.** `inbound=state` alone is an argument error naming the field; no
  rule picks a side for the recipe, because which side is right is the workspace's business.
- **Every inbound field must be mapped** in `fields=`; `key` is never inbound, since it names the
  delivery.
- **`state` may be mapped only when it is declared inbound.** Without the declaration it stays
  the person's and is refused with ADR 0210's words, and every field not declared keeps
  ADR 0210 §5 unchanged.

### 3. An inbound field's base is the last value that came from outside

For a declared field, `written[field]` holds **the last value that came from outside, whether
or not it entered**. With `current` on disk, `next` from the row and `last` the base:

| Case                        | Result                                              |
| --------------------------- | --------------------------------------------------- |
| `current` is already `next` | stays; the base moves to `next` if it was not there |
| `current` is `last`         | `next` enters, and so does the base                 |
| `next` is `last`            | the record moved alone, and is kept                 |
| neither: both changed       | the winner decides, and the plan says so            |

The plan names a conflict on the folder's line: `<folder>: updates state (both changed; row wins
over 'doing')`, or `<folder>: keeps state (both changed; record wins over 'review')`. **When the
record wins, the base still moves to the outside value in the same write**, so the conflict is
planned and logged once, not on every run. The merge is `mergeDeliveryRecord`'s, in `core`, with
the winners an optional third argument.

### 4. A delivery's data and its base live in its folder

**A delivery's data, and the base its inbound fields are merged against, live in the record
inside the delivery's folder**, so they travel with the folder when it is synced to the cloud.
The machine-local state of ADR 0140 stays for recipe memory that is not delivery data: a
recipe's own `remember` stores, a sync between two outside systems.

**Several machines writing one folder is the cloud phase** (maintainer, 2026-11-08) and is not
designed here: two machines merging the same record at once can still overwrite each other,
and the record's digest check before each write (ADR 0210 §3) is the only guard.

**Tyto names no provider** (ADR 0011, ADR 0127): a Drive or OneDrive folder is only the path the
project's `delivery.parent` points at, synced by the provider's own client.

## Consequences

- ADR 0210's "Not decided: how the check and the ship read the record" is answered for reading:
  **they read it through `deliveries`**. What the check and the ship do with the rows is still
  their own cards.
- `@tyto/core` gains `DELIVERY_WRITABLE_FIELDS`, `deliveryFormatsText`, the inbound winner types
  and the merge's `conflicts` and `based`; `@tyto/recipe` gains the `deliveries` verb and
  `inbound=`; `@tyto/io`'s `workspaceDeliveryPorts` gains `list`; `@tyto/plugin-api` re-exports
  `DeliveryListing`.
- A sheet becomes a report a recipe writes from `deliveries`, through whatever plugin writes
  sheets; a sheet a third party edits comes back through `inbound=`.
- The desktop draws `deliveries` like any other source; how its form looks with no fields was
  not checked in the window.

## Rejected

- **An implicit winner** (the row, say, as the status sync of ADR 0140 lets the sheet win). A
  manager's sheet and a designer's folder each have cases where they are right; a default would
  decide silently for a workspace that never thought about it.
- **Keeping the base on the machine** (ADR 0140's store). It would not travel with a synced
  folder, and a second machine would see every inbound value as both-changed.
- **Records as columns of `to-delivery`'s input only, with no source.** The folder could not be
  the source of a recipe, and a sheet would stay the only place rows come from.
- **A `from=` on `deliveries`.** A second place deciding where deliveries live, beside
  `delivery.parent`.
- **Reading every level below the parent.** A delivery is one folder under the parent
  (ADR 0157); a deeper `editaveis/` belongs to something else.
