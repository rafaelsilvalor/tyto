# 0210 — A delivery may exist without a brief, and a record in its folder says what it is

Status: accepted · 2026-11-17 · TYTO-755 · amends ADR 0157; builds on ADR 0111, ADR 0112, ADR
0129, ADR 0136, ADR 0170 and ADR 0172

## Context

ADR 0157 made a delivery one folder per piece of work, named after its ticket, with `assets/`
and `editaveis/` inside, and every way into one starts at a brief: `tyto delivery new` writes
one, and a delivery's export renders the brief that lives in it. On 2026-11-17 the maintainer
asked Tyto to keep the work folder of a piece made in another program too (E29): a creative
piece has no brief, so nothing tells Tyto what the folder is for, which formats it owes, or where
it ships.

**What exists at `origin/main` c06b892a, read in the code.**

- `to-brief` (ADR 0172) is the generic sink that writes one file per row, through ports a host
  lends, with a plan before any write, a digest checked before each write and a refusal in a
  restricted folder. Its folder is `into=`, read from the recipe's folder.
- `deliveryNameOf` in `core` applies ADR 0157 §4's name rule and refuses a name, never rewrites
  it.
- `loadWorkspace` in `@tyto/io` resolves the project's `delivery` layout, `parent` confined to the
  workspace lexically and after `realpath`.
- "Task" is taken: ADR 0157 left it to `tyto watch` and `RenderTask` (ADR 0011).

## Decision

### 1. A delivery may exist without a brief; its record is its identity

**A delivery folder may hold no brief.** What it is for is then said by a **delivery record**:
one JSON file inside the folder, written by a recipe and read, later, by the check and the ship.
A delivery made from a brief may carry a record too; nothing changes for one that does not.

The name is "delivery record", not "task record" as the card proposed: ADR 0157 gives "task" to
`tyto watch` and `RenderTask`, and the folder is already called a delivery.

### 2. Where it lives and what it holds

**`<delivery>/editaveis/delivery.json`**, beside the brief a delivery may also have, never at
the folder's root, which ADR 0157 §6 keeps for artwork alone. The place is fixed, not
`delivery.brief`: a layout whose brief folder is `.` would otherwise put the record at the root.

```jsonc
{
  "version": 1,
  "key": "MCA-1", // the tracker's key, required
  "link": "https://tracker.example/MCA-1",
  "formats": [{ "format": "feed", "count": 3 }], // what it owes, and how many of each
  "stem": "mca-1_aula", // the file names' stem
  "copy": "…", // where the copy comes from
  "due": "2026-11-20", // ISO 8601: a date, or a time with its offset
  "ship": "…", // where it goes
  "state": "doing", // the person's; a recipe never writes it
  "written": { "key": "MCA-1", "due": "2026-11-20" }, // what the recipe last wrote
}
```

- **Generic fields only** (ADR 0136). A company's words — its tracker, its sheet's columns — stay
  in the recipe and the workspace's configuration, which map their columns onto these fields.
- **A key the schema does not know is kept**, so a record a person or a later Tyto extended
  survives this one. The schema is `deliveryRecordSchema` in `core`, exported.
- `formats` is written in a cell as `feed:3,story:1`; a format without a count owes one.

### 3. A recipe writes it: `to-delivery`

`to-delivery name=<column> fields=<field>:<column>,…` (or `fields=@./file.json#/pointer`, ADR 0136) is a generic sink beside `to-brief`, with its ports (`ToDeliveryPorts`) lent by the host
and its plan and Apply built as `to-brief`'s are (ADR 0129, ADR 0170, ADR 0172): one `record`
operation per folder that needs a write, the shown plan kept by the verb, the record's digest
checked before each write, nothing planned or written in a restricted folder (ADR 0111). Apply
makes the delivery's folder, the layout's `folders` and `editaveis/`, then writes the record.

- **No `into=`.** Only the project's `delivery.parent` decides where a delivery lives (ADR 0157
  §2). The host reads the layout again on every run and every Apply.
- **`state` is refused** as a field to map, and so is a field the record does not have; `key`
  must be mapped.

### 4. A name is refused, never rewritten (ADR 0157 §4)

The folder's name goes through `deliveryNameOf`. **A row whose name cannot be a folder's is
refused and named in the cell's note, and the other rows still plan**; the same holds for a row
whose due date is not ISO, whose formats do not read, whose key is empty, or whose record on disk
is not one. **A tracker title holding `:` blocks that row** until the recipe changes it with
`rewrite` before the sink, which is where a company decides what its names become.

### 5. A record on disk is merged field by field, against what the recipe last wrote

**The record keeps a base, `written`: the value the recipe last wrote for each field it maps.**
For each mapped field:

| On disk               | Result                                                       |
| --------------------- | ------------------------------------------------------------ |
| already the new value | nothing                                                      |
| equal to the base     | takes the new value, and so does the base                    |
| anything else         | kept: a person edited it; the plan says `kept: due (edited)` |
| no record             | the record is created with every mapped field                |

A field with no base counts as last written empty, so a value a person typed before the recipe
mapped that field is theirs. An empty cell removes a field nobody edited.

The plan has **one operation per folder**, `<folder>: new` or `<folder>: updates due, link`, and
**a row whose record would not change has none**, so a second run over the same rows plans
nothing.

## Consequences

- `E_RECIPE_DELIVERY` reports what stops the whole step; refused rows are a note, not a code.
- `@tyto/io` gains `workspaceDeliveryPorts`, and the shared recipe runner lends them to every
  host, the desktop and `tyto mcp` included, whatever templates the host has.
- **The explorer's badge for a folder with a record is a later pull request** (TYTO-755 PR B);
  this one changes nothing in the window but the step form's Portuguese.
- A row whose only difference is a field a person edited plans no operation, so the plan names
  `kept` only beside a field it does update.
- A delivery folder whose `assets/` was deleted after its record was written is not given a new
  one until the record changes.
- Not decided: how the check and the ship read the record and `state`; later cards of E29.

## Rejected

- **"Task record" and `editaveis/task.json`.** "Task" is taken (ADR 0157 §1).
- **The record at the folder's root.** The root holds artwork alone (ADR 0157 §6).
- **Filling only empty fields.** A due date changed in the tracker would never reach a record
  already written; the base is what tells a person's edit from the recipe's last write.
- **Replacing the record whole.** A person's edit, and `state`, would be lost on every run.
- **`into=`.** A second place deciding where deliveries live, beside `delivery.parent`.
- **Sanitising the name.** ADR 0157 rejected it for the same reason: one ticket would map to a
  folder whose name nobody typed.
