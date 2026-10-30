# 0157 — A delivery folder is one key in the project file, and it exports its artwork alone

Status: accepted · 2026-10-30 · TYTO-488 · amends ADR 0057 (the export box and an export preset
no longer write `editaveis/` or `assets/`), adds a row to ADR 0111's table and a key to ADR
0112's file; builds on ADR 0054, ADR 0114, ADR 0126 and ADR 0155 · decision 6 amended by ADR 0161
(2026-10-30, TYTO-499: a delivery's export copies the brief's images into its `assets/`)

## Context

On 2026-10-30 the maintainer described how the team keeps its work: **one folder per piece of
work inside the project, named after its ticket** (`mca-66910_simule-sua-nota-da-2ª-fase`), with
`assets/` and `editaveis/` inside, the brief saved in `editaveis/`, and the final artwork written
at the folder's root. He asked for it to be configurable, with that layout as the default, per
project and per "campaign". The same day he asked that **the old export stop scaffolding**: "A
exportação antiga agora não faz mais o scaffold nem salva brief, apenas exporta arte na pasta
escolhida."

**What exists at `origin/main` 4a26e5a, read in the code.**

- The project file and the work profile are two sheets merged key by key, the later winning, a
  list replaced whole, plugin sections and export presets merged by name (ADR 0112, ADR 0114,
  ADR 0126). A relative path resolves against the sheet that wrote it, except a preset's
  `folder`, which resolves against the workspace folder (ADR 0126).
- **ADR 0057 already calls this layout a delivery**: `fsDeliveryOutput` in `@tyto/io` writes the
  artwork at the top, the brief as `editaveis/<name>.brief`, `template.txt` and `result.json` in
  `editaveis/`, and the brief's images in `assets/`. A brief in a folder named `editaveis` reads
  `../assets` as a third image folder (ADR 0057), so a brief kept in `editaveis/` already finds
  the folder's `assets/`.
- The export box delivers that way (`delivery: true` in `apps/desktop/src/main/export.ts`), and so
  does a preset, which runs through `export:start` (ADR 0126).
- A new brief is a skeleton: a configuration's `brief.skeleton` (TYTO-440) or `briefSkeleton`
  computed from the manifest (`packages/editor/src/skeleton.ts`).
- A profile name is refused, never rewritten, by a rule written for Windows (ADR 0114).
- "Task" is taken: `tyto watch` renders "every task dropped into inbox" and the code has
  `RenderTask` (ADR 0011).

**Exporting into a delivery folder the ADR 0057 way would damage it.** With the folder's root as
the destination, `fsDeliveryOutput` writes `editaveis/<name>.brief` over the person's own brief,
and runs ADR 0057's leftover rule on `assets/`: an image the brief on disk named and the brief
being exported does not is removed. Here `assets/` is the person's working stock, not a copy Tyto
made. A person who switched an image in the editor without saving, then exported, would lose the
first image from the folder they work in. So the folder's export cannot be ADR 0057's.

## Decision

### 1. Names

**A delivery is the folder**: one per piece of work, made by Tyto, kept by the person, holding
the brief, its images and the final artwork. The maintainer chose the word on 2026-10-30, over
"task", which the queue already uses. ADR 0057 used "delivery" for the layout an export wrote;
from this ADR on the export box no longer writes one (decision 7), so the word means the folder
alone.

| Surface      | Name                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| Project key  | `delivery`, in `.tyto/project.json` and `profile.json`                   |
| Command line | `tyto delivery new <name> [--template <name>]`; `tyto render --delivery` |
| Window       | `delivery.new` ("Delivery: New…" / "Entrega: nova…"), `delivery.export`  |
| Diagnostics  | `W_DELIVERY_NAME_INVALID`, `E_DELIVERY_BRIEF_EXISTS`                     |

**A delivery is not an export preset.** A preset (ADR 0126) is a named destination fixed in the
project file, and running it writes artwork into that one folder whatever brief is in front. A
delivery is a folder per piece of work, chosen by the brief that lives in it, and its export
follows that brief. They share the spec of what is exported, `formats` and `types`, and nothing
else: a preset has no brief and no `editaveis/`, and a delivery has no name in `exportPresets`.

### 2. The key

**`delivery`, in `.tyto/project.json` and in a work profile**, with this shape and these defaults:

```jsonc
"delivery": {
  "parent": ".",                       // where deliveries are made, against the workspace folder
  "folders": ["assets", "editaveis"],  // made inside every new delivery
  "brief": "editaveis",                // the folder the brief is saved in
  "exports": ".",                      // where the delivery's artwork is written
  "formats": ["grid", "story"],        // optional: what the delivery exports
  "types": ["png"]                     // optional: which exporters
}
```

- **Every subkey is optional, and so is the key.** A subkey no sheet writes takes the built-in
  value above; `formats` and `types` are answered in decision 6. With no `delivery` anywhere, a
  workspace makes deliveries in that layout.
- **Merged per subkey**, the later sheet winning, as ADR 0112 merges keys: a folder that writes
  only `"exports": "final"` keeps the profile's `folders`. `folders`, `formats` and `types` are
  lists and are replaced whole, never concatenated (ADR 0112).
- **Read one subkey at a time and tolerant** (ADR 0073 rule 5): a refused subkey is
  `W_PROJECT_KEY_INVALID` at its range and falls through to the sheet before it, or to the
  built-in value. An unknown subkey is `W_PROJECT_KEY_UNKNOWN`. A list whose every entry was
  refused counts as not written. Unlike a preset (ADR 0126), a refused subkey falls through: each
  one names a place inside a folder the person sees, so the default puts that place somewhere
  predictable instead of losing the delivery.
- `ResolvedProject` gains `delivery`, resolved, with an origin per subkey (`profile`, `folder`, or
  absent for a built-in value), as `origins` does for the place keys (ADR 0114).

### 3. Where each path resolves, and confinement

- **`parent` resolves against the workspace folder, whichever sheet wrote it**, the exception
  ADR 0126 made for a preset's `folder` and for the same reason: a profile's `"parent":
"entregas"` means the campaign's `entregas/`, never `~/.tyto/profiles/<name>/entregas`.
- **`folders`, `brief` and `exports` resolve against the delivery's own folder.** Each is a
  relative path that stays inside it; `"."` is the delivery's root and is valid for `brief` and
  `exports`, not as an entry of `folders`. `brief` and `exports` need not be listed in `folders`:
  the folder they name is made when it is needed.
- **A delivery and everything in it are confined to the workspace folder, trusted or not.** A
  delivery is part of the project by definition, so a trusted sheet gains nothing by placing one
  elsewhere. Both of ADR 0112's halves run: lexically in `core`, then after `realpath` in
  `@tyto/io`, so a junction inside the workspace that lands outside is outside. A refused value
  is `W_PROJECT_PATH_OUTSIDE` at the subkey, which falls through (decision 2).
- **Inert under ADR 0111.** The key names folders, and the run makes empty ones and one brief; it
  runs nothing. ADR 0111's table gains the row.
- **Outside any workspace** the command line uses the built-in values, with the current folder
  as the parent and as the root of confinement. The window makes a delivery only in an open
  folder.

### 4. The delivery's name

**A name is refused, never rewritten.** It becomes one folder name, and a second sanitiser
beside the file system's own is how one delivery ends up as two folders (the argument of
`fsDeliveryOutput`'s name guard). It follows ADR 0114's rule for a profile name, which was written
for the same reason:

- refused with `W_DELIVERY_NAME_INVALID` when it is empty, starts with a dot, holds `..`, holds a
  path separator (`/` or `\`) or a character no Windows folder name may hold (`< > : " | ? *` or a
  control character), ends in a space or a dot (which Windows drops), or is a device name Windows
  reserves (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with or without an
  extension, in any case);
- **at most 100 characters**, not ADR 0114's 64: a ticket key and a title fit
  (`mca-66910_simule-sua-nota-da-2ª-fase` is 36), and 100 leaves room under Windows' 260 for the
  workspace's own path, `editaveis\` and the brief's name twice;
- **any other Unicode is accepted**, `ª`, accents and spaces included;
- **normalised to NFC before it is used**, so an `ã` typed as one code point or as two names one
  folder, and the brief inside carries the same spelling. Case is not folded: the file system
  decides, as it does for a profile.

The command line and the window apply the same rule, from one function in `core`.

### 5. What `tyto delivery new` makes

`tyto delivery new <name>` (TYTO-489), and `delivery.new` in the window, make inside the resolved
`parent`:

```
<name>/
  assets/
  editaveis/
    <name>.brief
```

- **An existing delivery folder is reused**, and the `folders` it lacks are made. A person who
  made the folder by hand, or dropped images into it before starting, keeps all of it. This
  changes the card, which assumed a new folder, on purpose.
- **An existing brief is refused** (`E_DELIVERY_BRIEF_EXISTS`, naming the file) and nothing is
  written, not even the missing folders: a delivery's brief is never overwritten, and a run that
  refuses changes nothing.
- **The brief's name is `<name>.brief`** in the `brief` folder, the name ADR 0057 gave a brief in
  `editaveis/`.
- **The brief is a template's skeleton when a template is named** (`--template`, or the window's
  picker): the configuration's `brief.skeleton` when it has one, otherwise `briefSkeleton` from
  the manifest, with the configuration's formats (TYTO-440). **The template is optional.** Without
  one the brief is empty, and the window opens it with the "/" menu, which writes a skeleton into
  a brief that holds only the "/".

### 6. A delivery's export writes artwork, and only artwork, into `exports`

`delivery.export` and `tyto render --delivery` (TYTO-490) export the brief of a delivery:

- **The artwork is written into the resolved `exports` folder** (the delivery's root by
  default), named as every export names it.
- **`result.json` and `template.txt` are written into the `brief` folder** (`editaveis/`), where
  ADR 0057 kept them, so the root holds artwork and nothing else.
- **ADR 0054's leftover rule applies to the artwork**, read from that `result.json`: a file the
  previous export of this delivery wrote and this one did not produce is removed with
  `W_LEFTOVER_REMOVED`.
- **The brief is not copied, and the images are not copied, rewritten or removed.** They are the
  delivery's own files, already in place; the brief in `editaveis/` reads `../assets` (ADR 0057).
  - 2026-10-30, amended by ADR 0161 (TYTO-499): the images the brief uses from outside the
    delivery's `assets/` are copied into it. Nothing there is ever removed or replaced, and the
    brief is still not copied or rewritten.
- **Formats:** `delivery.formats` when a sheet writes it, otherwise the brief's own (its
  `formats:`, or its configuration's default), always inside the bound a configuration's
  `formats` restriction sets (ADR 0155): a format outside it is `E_UNKNOWN_FORMAT`, as anywhere.
  **Types:** `delivery.types`, otherwise `png`, as for a preset (ADR 0126).

### 7. The export box and a preset write only artwork (amends ADR 0057)

**The export box and an export preset write the artwork into the chosen folder and nothing
else**: no `editaveis/`, no brief, no `assets/`, no `template.txt` and no `result.json`. A
delivery now keeps the editable side, and an export is what it says.

- **No `result.json` in the folder means no record, so ADR 0054's leftover rule no longer runs
  for the export box or a preset.** Files are overwritten by name and nothing is removed. This
  brings back, for these two paths only, the case ADR 0054 measured: exporting four artworks and
  then three into one folder leaves the fourth. It was preferred to a record kept somewhere else,
  which would be a second place, one the person cannot see, deciding what is deleted from a
  folder they chose. A delivery's export keeps the rule, because its record has a place to live.
- **Unchanged:** `tyto render --out`, the queue and `tyto watch`, whose `result.json` is the ADR
  0011 contract; `tyto render --folder`, the command line's ADR 0057 layout, which this ADR leaves
  as it is (superseded on 2026-10-30, TYTO-490: `--folder` writes only artwork too, see "Not
  decided" below); and the `../assets` folder a brief in `editaveis/` reads (ADR 0057), which a delivery
  depends on.

### 8. A campaign is a work profile

**A "campaign" is a work profile (ADR 0114)**, not a new concept. A profile already is the sheet
many campaign folders name and override, so a campaign's delivery layout is its profile's
`delivery`, and one campaign folder overrides a subkey in its own `project.json`. A third layer
would need an order, a trust answer and a place in the Project panel, and no case has been
measured that a profile cannot hold.

## Consequences

- No code in this pull request. TYTO-489 builds the key, the name rule and `tyto delivery new`
  with `delivery.new`; TYTO-490 builds `delivery.export`, `tyto render --delivery` and the change
  to the export box and the preset. Each documents its part in the user manual, in both editions
  (ADR 0101), and adds its codes to `docs/diagnostic-codes.md`.
- Once TYTO-490 turns ADR 0057's layout off in the window, `fsDeliveryOutput` keeps one caller,
  `tyto render --folder`, and its name no longer matches the word: renaming it belongs with
  whatever is decided for `--folder`. (Superseded on 2026-10-30, TYTO-490: `--folder` went to
  artwork only as well, so `fsDeliveryOutput` lost its last caller and was removed;
  `fsArtworkOutput` writes for the export box, the presets and `--folder`.)
- A person who relied on the export box to hand over a self-contained folder (brief and images
  beside the artwork) now gets that from a delivery, not from the box.
- Not measured: how a delivery folder synchronised by Drive or OneDrive behaves when `tyto
delivery new` reuses it while another machine is writing into it.
- Not decided: whether `tyto render --folder` follows the export box to artwork only; a list of
  deliveries in the window; renaming a delivery.
  - 2026-10-30, decided by the maintainer (TYTO-490): `tyto render --folder` writes only the
    artwork too, in the `<out>/<brief-name>/` folder it already made. Nothing writes ADR 0057's
    layout any more but a delivery's own folder.

## Rejected

- **"Task" as the word.** The queue, `tyto watch` and `RenderTask` already mean something else by
  it (ADR 0011).
- **The folder's export as ADR 0057's delivery into its root.** It rewrites the person's brief
  and can remove an image from `assets/` (Context).
- **The folder's export as an export preset whose folder is the delivery's.** A preset's folder
  is fixed in the project file and the delivery is chosen by the brief in front; a preset with a
  variable folder would be a second kind of preset.
- **Sanitising the name** (`ª` → `a`, `:` → `-`). One ticket would map to a folder whose name
  nobody typed, and two names could map to one folder.
- **Confinement only for a restricted sheet**, as ADR 0112's other path keys have it. A delivery
  outside the project is never what a sheet means, trusted or not.
- **A campaign as a new layer** between profile and folder (decision 8).
- **Keeping `result.json` in the export box's folder.** The maintainer asked for artwork alone in
  the chosen folder.
