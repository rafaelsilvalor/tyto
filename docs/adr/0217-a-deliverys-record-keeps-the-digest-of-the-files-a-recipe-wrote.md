# 0217 — A delivery's record keeps the digest of the files a recipe wrote into it

Status: accepted · 2026-11-19 · TYTO-756 · amends ADR 0210 and ADR 0213; builds on ADR 0127,
ADR 0129, ADR 0130 and ADR 0170

## Context

A piece made in another program has no brief, so its copy never reaches a template: the
designer copies the text from a Google Doc or the tracker by hand (TYTO-756, epic E29). The
delivery folder is the source (ADR 0211), so the copy belongs in it, as a file the designer
opens beside the editable.

Two writers were weighed while planning the card, read in the code at `origin/main` 1ac3ef73:

- **A plugin action** writing through `host.workspace.write` (ADR 0130 decision 2). It suits
  bytes from a remote, the assets a row names, and stays in the plugin that knows the remote.
- **`to-delivery`**, which already owns the record and its base (`written`, ADR 0210). The copy
  may come from any provider (a Doc's text through a Google verb, a tracker's description through
  another), so the text arrives as a column and Tyto writes it, naming no provider (ADR 0127).

A copy is text a person edits: they fix a line for the layout. A run must never write over that,
and a machine-side store would lose it when the folder moves to another machine, which is the
reason ADR 0210 put the base in the record.

## Decision

1. **`to-delivery copy-text=<column>` writes `editaveis/copy.md`.** The file is the record's
   `copy` as a `Source: <copy>` line, a blank line, then the cell's text as it is, Markdown or
   plain, ending in one newline. With no `copy`, the file is the text alone. An empty cell leaves
   the file alone. The sink is format-agnostic: what the column holds is what the file holds.
2. **The record remembers the digest of each file it wrote**, in `written.files`, by the file's
   path relative to the delivery:

   ```jsonc
   "written": { "key": "MCA-1", "copy": "https://…", "files": { "editaveis/copy.md": "<sha-256>" } }
   ```

   The digest is the host's (`ToDeliveryPorts.digest`, SHA-256 of the UTF-8 in `@tyto/io`), the
   same one `stat` answers, so the base compares with the file on disk. A host without `digest`
   refuses `copy-text=`.

3. **Three ways a copy file can stand**, the base being the digest last written there:
   - the file already holds the row's copy: nothing, or only the base catches up
     (`copy.md already holds the copy`);
   - the file is missing, or still what the recipe wrote: it takes the row's copy
     (`copy.md new`, `copy.md replaced`);
   - otherwise **a person edited it, and it is kept, never overwritten**. The plan's note says
     `Kept N copy.md file(s) edited since the last run, never overwritten: <folders>` on every
     run, and a record write for another reason says `kept: copy.md (edited since the last run)`.
     A copy file the recipe never wrote counts as edited: it is somebody's.
4. **One operation per row, as before** (`record`, ADR 0170). A copy write rides with the record
   write that remembers its digest, written first: a copy that fails leaves the record as it was,
   and the next run plans the same write again. Apply compares both digests with the plan's
   (`before`) and fails the row when either changed since.
5. **Assets are not this sink's.** Bytes from a remote stay with the plugin that reads it, as an
   action writing through `host.workspace.write` (ADR 0130), which needs no change here.

## Consequences

- A designer gets the copy in the folder they work in, with where it came from on top, and a
  copy they fixed survives every later run, on any machine that has the folder.
- `written.files` is a map, so a later file a recipe keeps (a brief, notes) takes its base the
  same way without another field.
- The new copy waits while an edited file is kept: the person removes the file, or puts it back
  as it was, to take it. Nothing merges the two texts.
- A file edited on disk changes no cell's signature, so the notebook reuses a planned cell until
  the step runs again (Run from here, Fetch again, or an edit above it); the note then says so.
