# 0213 — A delivery record keeps the fields a recipe declares

Status: accepted · 2026-11-18 · TYTO-776 · amends ADR 0210 and ADR 0211; builds on ADR 0127,
ADR 0136 and ADR 0157

## Context

ADR 0210 gave a delivery record seven fields a recipe may write (`key`, `link`, `formats`,
`stem`, `copy`, `due`, `ship`), and `to-delivery` refused any other. Three cards of E10 need
more, read in the code at `origin/main` ed3d5479 while planning them: a task's description
(TYTO-765), a variant and a file name (TYTO-761), and an assignee that comes back from the
tracker (TYTO-762).

One fixed field per card would put a company's words into `core` one at a time, which ADR 0136
and ADR 0127 forbid. TYTO-765 also brings rows for work that has no delivery folder yet, and
`to-delivery` would make a loose folder for each.

## Decision

### 1. A recipe declares its own fields

**A name in `to-delivery fields=` that is not a fixed field is a declared field.** Its value is
text. The record keeps declared fields in a map, `fields`, and their base in `written.fields`,
a map of the same shape:

```jsonc
{
  "version": 1,
  "key": "MCA-1",
  "fields": { "assignee": "ana", "description": "Cover, three slides" },
  "written": {
    "key": "MCA-1",
    "fields": { "assignee": "ana", "description": "Cover, three slides" },
  },
}
```

- **A name is lowercase letters, digits, `_` and `-`**, starting with a letter or digit.
- **Every column name `deliveries` already gives a row is refused** as a declared name: `folder`,
  `path`, `key`, `link`, `formats`, `stem`, `copy`, `due`, `ship` and `state`
  (`DELIVERY_ROW_COLUMNS` in `core`). A declared column would otherwise shadow one of them. The
  refusal is an `E_RECIPE_DELIVERY` at the argument, in `fields=`, `keep=` and `inbound=` alike.
- **A name two edits or fewer from a fixed field's** (`lnik`, `link`; a swap of two neighbours
  counts as one edit) is declared all the same, with `W_RECIPE_DELIVERY_FIELD_NEAR` at
  `fields=`. Before this ADR such a name was refused; now it would be written silently as a new
  field beside the one the recipe meant. A warning, not a refusal: `stage` is a fair name near
  `state`.
- **The merge is ADR 0210 §5's and ADR 0211 §3's**, field by field: a person's edit is kept,
  `inbound=` names a winner, `keep=` holds a value whose cell came back empty. Only where the
  value and its base live differs. `mergeDeliveryRecord` takes any name; one that is not a
  `DeliveryWritableField` is declared. `fields` leaves the record when it holds nothing.

### 2. Old records still read

**A record without `fields` is read as before**, and one written by a recipe that declares
nothing has no `fields`, so its bytes do not change.

The schema does not check `fields`, so a record written by hand that holds another shape under
that name still reads (ADR 0210 §2 keeps a key the schema does not know). `deliveries` reads it
without declared fields and warns with `W_RECIPE_DELIVERY_FIELDS_UNREAD`, naming its folder.
`to-delivery` with declared fields leaves that row out, named in the note, rather than write
over what a person put there; without declared fields it merges the row as before.

### 3. `deliveries` gives declared fields as columns

After the fixed columns, **one text column per declared name any record read holds, in
alphabetical order**, so a column keeps its place from run to run whatever order the folders
are read in. A record without the field gives an empty cell.

### 4. `to-delivery create=no` writes only into folders that exist

**`create=yes|no`, `yes` by default.** Under `no`, the step lists the folders under
`delivery.parent` once per run (the `list` port of ADR 0211, case folded as the duplicate check
is), and a row whose folder is not there plans nothing. The note counts and names those rows:
`Skipped 1 row with no delivery folder: 'T-9'.` No port changes.

## Consequences

- `core` gains `DELIVERY_ROW_COLUMNS`, `DeliveryFieldName`, `declaredFieldProblem`,
  `nearFixedField`, `isDeclaredFieldMap` and the two warning codes. The merge's field types
  widen from `DeliveryWritableField` to `DeliveryFieldName`.
- Which field a company needs, and what it calls it, stays in the workspace's recipe.
- A recipe whose `fields=` held an unknown name used to stop; it now declares that field.
- **Under `create=no`, a folder deleted between the plan and Apply is made again** by Apply,
  which makes a delivery's folders before writing the record, as it does for every write. A
  guard needs a port that tells a missing folder from a missing record; not built.

## Rejected

- **One fixed field per card** (`description`, `variant`, `assignee`). Company words in `core`,
  one card at a time (ADR 0136).
- **Declared fields at the record's top level.** A later fixed field could collide with a name a
  workspace already uses, and a top-level key the schema does not know is already a person's or
  a newer Tyto's (ADR 0210 §2).
- **Values other than text.** Every need on the table is text; a type can come with a card that
  needs one.
- **Refusing a near name.** A workspace may mean `stage`; a warning tells a slip from a choice
  without deciding for it.
- **A port that asks whether a folder exists.** `list` already answers it once per run, where a
  port would ask once per row.

## Note, 2026-11-18: `with-deliveries` reads the records beside other rows (TYTO-779)

A recipe whose rows come from a tracker could not see each row's record: `deliveries` is a
source and replaces the table. **`with-deliveries by=<column>` is a transform** that, for each
row, finds the delivery folder its `<column>` names under `delivery.parent` and adds the
record's columns after the row's own.

- **Its own verb, not `deliveries by=`.** A verb has one kind whatever its arguments: the
  registry, the step forms and the step picker each read one kind per verb name, and no verb
  changes kind today. A `deliveries` that is a source without `by=` and a transform with it
  would be the first exception in all three.
- **Every brought column is a `deliveries` column with `record_` before it**, of the same kind,
  so `record_link` is a link and the rest are text: `record_folder`, `record_path`, the fixed
  fields, then the declared fields any record read holds, alphabetical, as §3 orders them.
  `record_folder` is the folder matched, empty only when the row has none, so a recipe tells a
  missing folder from an empty field. A table that already has one of these names is refused
  with `E_RECIPE_WITH_DELIVERIES` at `by=` rather than shadowed. The transform gives the
  source's refusals (no host, no workspace, a restricted folder) under that code too, so a
  handler tells the two verbs apart by the code.
- **The cell is read as a folder name as `to-delivery name=` reads it, and matched with case
  folded**, as `create=no` matches (§4). Two folders one fold apart are one folder where case
  is ignored: the first listed is matched, and `W_RECIPE_DELIVERY_RECORD` names the other.
- **One `list` per run, and no other port call.** The `list` port already returns each
  folder's record text, so no folder is read again. It never writes.
- `W_RECIPE_DELIVERY_RECORD` and `W_RECIPE_DELIVERY_FIELDS_UNREAD` now name the verb that
  reported them instead of always saying `deliveries`.

## Note, 2026-11-18: `fields=` names the declared columns a recipe needs (TYTO-784)

A declared field's column came only from the records read (§3), so on a recipe's first run no
record held `description` or `variante`, `record_description` did not exist, and every later
step that read it stopped with `E_RECIPE_UNKNOWN_COLUMN`. The column could not be made
beforehand either: `with-deliveries` refuses a table that already has a column it would add.

- **`deliveries fields=<name>,…` and `with-deliveries by=<column> fields=<name>,…`** list
  declared fields whose columns always exist, empty when no record holds them. They are merged
  with the declared fields the records hold, after the fixed columns, in alphabetical order, so
  a listed column sits where it will sit once a record holds it. `with-deliveries` puts
  `record_` before each, as before.
- **A listed name follows `to-delivery`'s rules** (`declaredFieldProblem`): a fixed column or a
  name that is not lowercase letters, digits, `_` and `-` is refused at `fields=`, under the
  verb's own code (`E_RECIPE_DELIVERIES`, `E_RECIPE_WITH_DELIVERIES`); an empty or repeated
  name is `E_RECIPE_ARGUMENTS`.
- **`with-deliveries`'s clash check counts the listed names**: a table that already has
  `record_<name>` for a listed name is refused as for any other column it would add.
- Plain text, comma-separated, not a data reference: the list is short, and `keep=` reads its
  names the same way.
