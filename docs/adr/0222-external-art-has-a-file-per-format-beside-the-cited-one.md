# 0222 — External art has a file per format beside the cited one, and its guide lives there too

Status: accepted · 2026-11-19 · TYTO-741 · builds on ADR 0056, ADR 0057, ADR 0117, ADR 0220 and ADR 0221

## Context

ADR 0220 let a template declare art painted outside Tyto, and ADR 0221 with its notes gave
`tyto render --guide` the layered PSD a designer paints in, one per format. Two things were left
open. A brief names one file per slot, drawn into every format's box, while a story and a
square post are painted separately (ADR 0220, "Naming the art per format"). And the guide is
written into `--out` under the render's own names, so nothing ties the PSD a designer opens to
the file the brief will read back.

TYTO-741 makes the guide a command a person runs from the window or the command line, which
opens it in their image editor. It lands in four pull requests: the core (this record's), the
command line's `tyto guide`, the desktop's main process, and its window. This record settles,
for all four, where a guide is written, what it is called, which file a format draws, and when
an existing guide is overwritten.

## Decision

1. **Each format may have its own file, beside the cited one.** For an external slot whose
   brief cites `grafico.png`, `resolve` asks the asset port for `grafico.<format>.png` once per
   rendered format (`<stem>.<format><extension>`; `<reference>.<format>` when the name has no
   extension), and `compile` draws the one found in that format in place of the cited file. A
   format with no copy draws the cited file; with neither, the box of ADR 0220. The brief's
   syntax does not change: the cited file names the art, and its copies sit beside it.

   - **Only external slots are probed.** Any other picture costs what it did: one question to
     the port. An external slot the brief names costs one more per rendered format; one the
     brief names no file for costs nothing, since there is no stem to look beside.
   - **Through the port, in the same folders.** The copy's reference is the cited one with the
     format put in, so the port looks for it where it looks for the cited file, in the same
     order (ADR 0056, ADR 0057), and a delivery's record copies it as it copies any picture it
     resolved. `core` touches no disk.
   - **Not for a plugin's source.** A reference with a URI scheme (ADR 0117) names an item in a
     plugin's source, not a file with siblings; it is not probed, so no plugin is asked for an
     item nobody named.
   - **`ResolvedBrief.externalArt`** carries the copies, by slot and then format, present only
     when one was found, and they join `ResolvedBrief.assets` after the cited file. A brief
     without a copy resolves to the object it did and compiles to the same bytes.
   - **`W_EXTERNAL_ART_MISSING` speaks of what is still a box.** A cited file that is not there
     warns as before when no format has a copy, names the formats left as a box (`for format
'feed'`) when some do, and is silent when every format does: a copy per format is a whole
     set of art, and the cited name is then only the stem.
   - **In a guide the art is empty**, its copies too (ADR 0220's note): a guide is what the
     designer is about to paint.

2. **A guide is named after the file it becomes.** A cited `grafico.png` gets
   `grafico.guide.psd` beside it when one format is rendered; with several,
   `grafico.<format>.guide.psd` for each, and the PNG painted from it is expected back at
   `grafico.<format>.png`, which decision 1 reads. An `inline` canvas follows the same rule with
   its own slot's file. The card's first sketch, `<slot>-<artwork>-<format>.guide.psd`, is
   dropped: a name tied to the art's file is the one a person finds beside it.
   `tyto render --guide` (ADR 0221's note) is unchanged and keeps writing
   `<artwork>-<format>.psd` into `--out`; it is a render, and a render writes to its output.

3. **A guide is written beside the cited file.** In the delivery's `assets/` for a brief in a
   delivery, else in `<briefDir>/assets`; except when the cited file already exists earlier in
   the asset search order (the brief's own folder), where the guide goes beside that file. A
   project's stock folders are never written to.

4. **An existing guide is overwritten only when it is older than the brief.** No guide, or one
   older than the brief, is written. A guide newer than the brief may hold the designer's
   paint: the window asks, and the command line refuses without `--force`, with
   `E_GUIDE_NEWER_THAN_BRIEF`, which the command line's pull request introduces.

5. **The window renders what is on disk.** A brief with unsaved edits is asked to be saved
   first, since the guide is rendered from the file.

6. **A repeating brief gets the first artwork's guide.** The art of an external slot is one per
   brief (ADR 0220 refuses it on a slot that repeats), so one artwork's layout is enough to
   paint it to.

## Still open

- **A second `full` slot gets no PSD of its own** (ADR 0220's note: the frame's art is the
  first `full` slot). Its box is in `areas`; painting it needs a canvas nothing writes yet.

- ~~**A brief that names no file for an external slot**~~ — settled in the note of
  2026-11-19 below.

## Rejected

- **A per-format key in the brief** (`fundo.story: ...`). It changes the brief's syntax for
  every template and every reader of a brief, to say what a file's name already says.
- **Probing every picture.** Only external art is painted per format by a person; a photo
  cited for every format is one photo, and asking the port for copies of it is a read per
  format per picture for nothing.

## Consequences

- A designer who exports `grafico.story.png` and `grafico.feed.png` beside the brief's
  `grafico.png` sees each in its format with no edit to the brief, and the warning goes away.
- An external slot costs one more read of the asset port per rendered format on every resolve,
  the editor's included.

## Notes

- **2026-11-19 (TYTO-741, `tyto guide`): a slot the brief names no file for gets no guide.**
  With no file named there is nothing to name the guide after and nowhere to put it, so it is
  not a candidate. `tyto guide --list` prints it as not cited, with the line that would cite
  one (`<slot>: <slot>.png`, or the `::<slot>` directive for a slot written under another),
  and the command writes nothing for it; the window's pull request offers to insert that line.
  Three more cases the command decides the same way, by giving no guide and saying why in
  `--list`: a citation of a plugin source's item (ADR 0117), which is not a file; a second
  `full` slot (still open above); and an empty value. An absolute cited path puts the guide
  beside it. `E_GUIDE_NEWER_THAN_BRIEF` is fatal for the run: when one guide in the way is
  newer than the brief, none is written, so a folder is never half regenerated.
- **2026-11-20 (TYTO-741, the desktop's main process): the window writes through `tyto guide`.**
  `guide:candidates` lists the guides with `guideCandidates` and `guidePaths` over the registry
  the preview compiles with; `guide:write` runs `tyto guide <brief> --only <names>` in-process,
  as the command panel runs a command (ADR 0159), rather than calling `writeGuides`, whose
  render context the command builds from the brief's workspace and plugins and the package keeps
  to itself: one way of building it, not two. The window names a guide by its file name and
  never sends a path. Decision 4's question is a native box main shows, keeping the guide the
  default; a yes adds `--force`. Each written guide is opened with the system's opener; when it
  answers that no program opens a PSD, or the brief's folder is restricted (ADR 0111: a folder
  not trusted does not get to start a program by writing a file), the guide is shown in its folder instead and the answer says which.
  **A preview follows the art painted beside it**: each preview answer names the files the
  compile asked the asset folders for, the per-format copies of decision 1 included, and
  `explorer:changed` names the files of the watcher's burst, so a brief that asked for a file
  of a changed name compiles again with no keystroke. Matched by file name, which costs at most
  a compile more than needed.
