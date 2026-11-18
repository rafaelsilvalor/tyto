# 0215 — A delivery's exports are checked against its record by pixel size

Status: accepted · 2026-11-18 · TYTO-757 · amends ADR 0157, ADR 0211 and ADR 0213; builds on
ADR 0136 and ADR 0210

## Context

A delivery's record (ADR 0210) says which formats it owes and how many of each, by name:
`feed:3,story:1`. A designer exports from another program into the delivery folder, and nothing
read those images against the record. Two needs meet here:

- **The person** wants to know whether a delivery is complete, and if not, what is missing or the
  wrong size, without opening a file.
- **A recipe** wants the shapes found, to fill a sheet's column in a company's words. A plugin
  already counts shapes on a remote folder (TYTO-761, `drive-count shapes=yes`): it snaps a ratio
  within 2% to `1:1`, `4:5`, `9:16`, `16:9`, `3:2` or `2:3`, writes `wide` above 2:1, its own
  ratio reduced otherwise, and `?` without a size. A recipe maps those words through the
  workspace's vocabulary table (ADR 0136); the local check must write the same ones.

The record's format names have no size, and a delivery without a brief has no template to ask.

## Decision

### 1. Sizes belong to the workspace: `delivery.sizes`

**The project file's `delivery` key gains `sizes`**, a map from a format name to its pixel size:

```jsonc
{ "delivery": { "sizes": { "feed": "1080x1350", "story": "1080x1920" } } }
```

- A size is `<width>x<height>` (`×` reads too), each a whole number above zero. An entry that is
  not one is `W_PROJECT_KEY_INVALID` at its value and left out; the others are kept. A value that
  is not an object is refused whole and falls through to the sheet before, as every `delivery`
  subkey does (ADR 0157 §2).
- **The subkey is merged whole**, the later sheet winning, as `formats` and `types` are.
- **A name `sizes` leaves out falls back to the host's format catalogue** (`formats.yaml`, the
  file a template's formats come from), by the same name. The host lends the catalogue to the
  recipe runner (`formatSizes`); a host that lends none knows `delivery.sizes` only.
- **The record does not change.** A size belongs to the workspace's formats, not to one task:
  two deliveries owing `feed` owe the same size.

### 2. The check is pure and lives in `core`

`checkDelivery` takes the formats owed, the sizes, the images found and how many editables sit
beside the record, and gives a state, its problems and the shapes found.

- **What it reads**: the PNG and JPEG files at the root of the delivery's `exports` folder
  (ADR 0157), not below it, hidden files left out; and every file in the record's folder other
  than the record, counted as editables. The host reads each image's width and height **from its
  header only**, with the reader `io` already has for embedded images (`imageSize`): no decode
  and no new dependency. It reads the first 256 KiB, and the whole file only when the size is
  not in them, as after a long JPEG metadata block.
- **Matching is by exact pixel size.** Each image goes to the first format of its size, in the
  record's order, that still owes one, so two formats of one size share the images before either
  counts an extra.
- **`ready`**: every format owed is there at its size, nothing is extra, and at least one
  editable is kept. **`incomplete`**: images landed and something is missing, extra, the wrong
  size, unreadable, or a format has no known size. **`in-progress`**: nothing has landed yet, or
  the record owes no formats.
- **Each problem is a sentence naming the format or the file**: `'feed' has 0 of 1 at
1080×1350`, `'feed.png' is 1080×1080, and the record owes feed 1080×1350, story 1080×1920`,
  `no size is known for 'reel'; add it to delivery.sizes`. A format with no size is named even
  while nothing has landed, since it is the workspace's to fix before the export.

### 3. One function snaps a shape, and plugins import it

**`aspectOf(width, height)` in `core` is the one place a shape is snapped**, with the plugin's
table, tolerance and words exactly. `aspectsText` writes a set of them as the plugin does,
`ratio:count` pairs, the most frequent first, ties by ratio: `4:5:1,9:16:1`. `plugin-api`
re-exports both, and a plugin that counts shapes elsewhere imports them instead of keeping a
copy. Until the plugin switches, a table test in `core` pins the plugin's edge cases, case for
case.

### 4. `deliveries` gives the check as three columns

After the record's fixed fields, every row has **`check`** (`ready`, `incomplete` or
`in-progress`), **`check_problems`** (the problems joined by `; `, empty when there are none) and
**`found_formats`** (the shapes found, empty when nothing landed). `with-deliveries` brings them
as `record_check`, `record_check_problems` and `record_found_formats`.

- **`check`, `check_problems` and `found_formats` join `DELIVERY_ROW_COLUMNS`**, so a declared
  field (ADR 0213 §1) cannot use these names; a recipe that declared one is refused at
  `fields=`.
- **Tyto ships no format words of its own.** A recipe maps `found_formats` to a company's word
  through the workspace's vocabulary table, the same table it maps a remote folder's shapes
  through.
- The ports change compatibly: `list(parent, exports?)` gives each folder with a record its
  `images` and `editables` when it is given the layout's `exports`, and the layout gains
  `exports` and `sizes`. Each path is confined on its own after `realpath`, as the record is
  (ADR 0211): an exports folder that leads out of the workspace holds nothing.

## Consequences

- `core` gains `checkDelivery`, `aspectOf`, `aspectsText`, `deliverySizeOf`,
  `DELIVERY_CHECK_COLUMNS` and `delivery.sizes`; `plugin-api` re-exports the two shape
  functions.
- `deliveries` reads every image header at the root of every delivery's exports folder on each
  run: a few hundred bytes each, in a folder of a few images.
- A recipe whose declared field was named `check`, `check_problems` or `found_formats` stops at
  `fields=` until it renames it.
- The window shows the state in the Explorer in a second change of this card; this one gives
  it to recipes.

## Rejected

- **Sizes in the record** (`feed:3@1080x1350`). Every record would repeat what the workspace
  decides once, and a size changed for the workspace would need every record rewritten.
- **Matching by aspect, not by size.** A `1080×1350` and a `540×675` are both `4:5`; a delivery
  owes the size it will be posted at.
- **Matching by file name.** Names are a person's, and four of six folders read on 2026-11-17
  named their exports differently.
- **Decoding the image.** The header says the size; decoding a 20 MB PNG to read two numbers
  would make every run of `deliveries` slow.
- **A copy of the snapping in each plugin.** Two copies drift, and a recipe that maps both
  through one table would meet a word only one side writes.
