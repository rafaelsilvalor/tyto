# 0161 — A delivery's export copies the brief's images into its assets, and never removes one

Status: accepted · 2026-10-30 · TYTO-499 · amends ADR 0157 §6 (a delivery's export now writes
into `assets/`); revives ADR 0118 decision 3 for that one writer; builds on ADR 0054 and ADR
0057

## Context

ADR 0157 §6 had a delivery's export write the artwork and its report and nothing else: "the
images are not copied, rewritten or removed", on the assumption that a delivery's images already
live in its `assets/`. The assumption fails whenever the brief draws from somewhere else: a
picture saved beside the brief in `editaveis/`, one from the project's image folders (ADR 0112),
one a plugin fetched into the source cache (ADR 0117). The delivery then does not hold what its
artwork was made from, and a person handing the folder over sends it incomplete.

On 2026-10-30, right after TYTO-490, the maintainer asked that the export-delivery button "export
the assets into the assets folder and the final art at the root", and decided the collision rule
the same day: a file of the same name with different content in `assets/` is the person's, is
kept, and the export warns.

ADR 0157 forbade writing `assets/` because ADR 0057's copier also **removed** from it. That fear is
about removal and replacement, not about adding a file, so this ADR adds files and does neither.

## Decision

1. **A delivery's export (`delivery.export`, `tyto render --delivery`) copies every image the
   brief resolved that is not already inside the delivery's assets folder into it**, after a run
   that finished: not cancelled and with no error, ADR 0054's test for "the export did not
   finish", so a cancelled or failed run leaves the assets folder as it was. What counts as
   "the images the brief resolved" is recorded as the run resolves them
   (`recordingAssetResolver`), so the copy is exactly what the artwork was drawn from.
2. **Which assets folder: the one the brief reads, by ADR 0057's rule.** A brief in a folder
   named `editaveis` reads `../assets`; any other brief reads `assets/` beside it. So with the
   built-in layout (`"brief": "editaveis"`) the copy lands in the delivery's root `assets/`, and
   with `"brief": "."` in the root's `assets/` too. **With a custom `brief` folder such as `x/y`
   it lands in `x/y/assets/`, not in the delivery's root `assets/`**: that is the folder such a
   brief searches, and a copy the brief never reads would make the folder look complete without
   making it render. It also keeps the decision inside the export, which knows the brief's folder
   and not the layout.
3. **"Already inside" is decided on real paths, at any depth.** An image whose real path is inside
   the real assets folder, in a subfolder or not, is the person's and is not copied. A brief that
   reaches it through `../assets`, a junction or another spelling is still inside. A fetched
   image, whose file is in the source cache, never is.
4. **The copy's name.** A local image keeps its file name; a fetched one is named after its
   reference by ADR 0118 decision 3 (`drive:pasta/Logo Final.png` → `Logo-Final.png`). Two
   different files of one run that would share a name are told apart with `-2`, `-3`, compared
   without case (ADR 0057). The same file named twice is copied once.
5. **Nothing in the assets folder is removed or replaced.** A file already holding the copy's name
   is compared by size and then by bytes:
   - the same bytes: skipped, in silence (an earlier export, or the person, already put it there);
   - other bytes: **kept**, with `W_DELIVERY_ASSET_KEPT` naming the kept file and the image the
     brief uses (its path, or its reference for a fetched image). The brief still draws from where
     it drew; the copy simply did not happen.
     A folder holding the copy's name is `E_OUTPUT_FILE_BLOCKED`, and a file holding the name
     `assets` is `E_DELIVERY_FOLDER_BLOCKED`, as for any other write (TYTO-129, TYTO-243).
6. **The brief is never rewritten.** It keeps pointing where it pointed. The folder is complete;
   whether the brief should be repointed at the copies is not decided here.
7. **Only a delivery's export.** The export box, an export preset and `tyto render --folder` stay
   artwork-only (ADR 0157 §7). ADR 0054's leftover rule still applies to the artwork alone.

## Consequences

- A delivery exported once holds the artwork and every image it was drawn from, the fetched ones
  under readable names; exporting again adds what is new and says nothing about what is there.
- `recordingAssetResolver`, `DeliveredAsset`, `fetchedStem` and the `-2` naming, removed with ADR
  0057's copier in TYTO-490, come back in `@tyto/io` in this narrower form (no removal, no rewrite).
  `deliverAssets` on the delivery's output and `deliveryAssetsFolder` are the new surface.
- An image replaced by hand in `assets/` stays replaced: the person's file wins, every time, with a
  warning each export until the names or the bytes agree.
- Not decided: repointing the brief at the copies; copying a template's own assets (they live with
  the template, ADR 0157 §6's `template.txt` points at it).
- Not measured: a delivery synchronised by Drive or OneDrive receiving a copy while another machine
  writes the same name.

## Rejected

- **Overwriting a same-named file** with the brief's image. The maintainer's rule is that the
  person's file is kept; it is the one they work from.
- **Copying into `<delivery>/assets` whatever the `brief` folder is.** Exact for the delivery's
  shape, but for a custom `brief` folder it puts images where the brief does not look, and it
  needs the delivery's root, which the export does not receive.
- **Re-scanning the brief's frontmatter for image paths** instead of recording what resolved: a
  second rule for which values are images, free to disagree with the first.
- **Hashing to compare** instead of size then bytes: the same answer with more work for the common
  case, where sizes already differ.
