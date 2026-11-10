# 0185 — `tyto mcp` writes only briefs, deliveries and exports, and shows the change first

Status: accepted · 2026-11-10 · TYTO-565 · builds on ADR 0179 and ADR 0180

## Context

ADR 0179 shipped `tyto mcp` with four reads and the rule that a folder nobody trusted is offered
no tool that writes. TYTO-565 also asks for the writes: create or write a brief, make a
delivery, export. The card adds that "writes say what they will change".

An agent writes on text it read, and the person who started it is not looking at every call. So
four questions had to be settled: which files an agent may write, how a change is seen before it
lands, where an export goes, and what happens to a brief the person has open in a window.

That last one was measured before it was decided. On 2026-11-10, against the built app on
Windows 11 (`TURBO_FORCE=1 pnpm build`, then a throwaway desktop e2e that was not committed),
one brief was open in a clean tab and another in a tab with one typed letter. A second program
wrote each file, the test waited 4 seconds, then pressed Ctrl+S:

```
PROBE clean: editor after 4 s = "titulo: Hello\nsubtitulo: World\n"
PROBE clean: title = "a.brief — work — Tyto"
PROBE clean: disk after Ctrl+S = "titulo: Hello\nsubtitulo: World\n"
PROBE unsaved: editor after 4 s = "titulo: Hello\nsubtitulo: World\nx"
PROBE unsaved: title = "b.brief (unsaved) — work — Tyto"
PROBE unsaved: disk after Ctrl+S = "titulo: Hello\nsubtitulo: World\nx"
      Tests  2 passed (2)
```

The window keeps the text it has: it does not reload, mark a conflict or show anything, and its
next save erases what the other program wrote, even from a tab with no unsaved changes. Read in
the code: a change on disk refreshes the explorer and the preview's images (`explorer:changed`
in `apps/desktop/src/renderer/main.ts`). Only the settings, keybindings and snippets tabs follow
their file.

## Decision

1. **Three tools that write: `write_brief`, `new_delivery` and `export`.** They enter `MCP_TOOLS`
   with the `write` access, so `toolsFor` offers them only to a trusted workspace (ADR 0179
   decision 3). A restricted folder, or none, never sees them. The window's server offers them
   on the same terms: the file tools behave the same either way (ADR 0180).

2. **`write_brief` writes a `.brief` and nothing else.** A project sheet, a plugin file, a
   template or a recipe would let an agent widen what it may do next: trust a plugin, change
   where exports go, or put markup in front of the person. None of them is a brief. The check is
   on the extension, case aside, before any path is resolved.

3. **A change is shown before it is made, and a replacement names what it replaces.**
   - `dry_run: true` writes nothing. It answers whether the write would create, replace or
     change nothing, the lines that change (`-` removed, `+` added, two lines of context, as
     `diff -u` prints them without hunk headers), and the SHA-256 of the file there now.
   - **A file that is there is replaced only with `replace` set to that SHA-256.** Without it,
     the call is refused and says to run a dry run first. With a hash that no longer matches,
     because someone changed the file since, it is refused as `stale` and the file is left
     alone. A create needs no hash and is written with `wx`, so a file another program created
     in between is never overwritten.
   - **A replacement is whole or nothing:** written to a temporary file beside the brief, then
     renamed over it.
   - Every answer carries the hash of the file as it is afterwards, so a second change needs no
     second dry run.
   - All three tools say they change files in their MCP annotations (`readOnlyHint: false`;
     `destructiveHint: true` for `write_brief` and `export`, which overwrite; `false` for
     `new_delivery`, which never does). A host that asks the person before such a call asks.

4. **A brief inside a folder a Tyto window has open is not replaced.** The measurement above
   shows why: the window's next save would erase the write without a word, and the person would
   never have seen it. ADR 0180 decision 5 already says an agent's change to a document in the
   window is a proposal. So when a live window's record (`TYTO_HOME/windows`, ADR 0180 decision 2) has a workspace that holds the brief, `write_brief` refuses the replacement and says to
   use `tyto mcp --window` and `propose_edit`. A new brief is still created: no tab can hold a
   file that did not exist. The rule is coarse on purpose. It refuses a brief no tab shows, but
   needs no new question to the window, and it applies to the stdio server and to the window's
   own server alike, because the window's record is in the same folder.

5. **A write stays inside the served folders, links followed, for a file that does not exist
   yet.** As for a read (ADR 0179 decision 5), the path is checked as typed first, with the same
   answer whether or not anything is there. Then a file that is there is followed to its real
   path. One that is not is placed under the real path of its nearest existing folder, because a
   link on the way decides where it would be created. A link that leads nowhere is refused,
   since nobody can say where a write through it would land.

6. **`new_delivery` is `tyto delivery new`.** It runs the same `planDelivery` and
   `createDelivery`, under the workspace's layout and with the workspace folder as the root the
   delivery must stay inside, links followed (ADR 0157 decisions 3 and 5). Its brief starts from
   `templateSkeleton`, as `describe_template` shows it. An existing folder is reused, and an
   existing brief is never overwritten. A dry run lists the folders it would make.

7. **The agent never names where an export goes.** `export` writes to a folder the person wrote
   in a sheet of this trusted workspace: a named export preset's folder (ADR 0126), the brief's
   delivery's `exports` folder (ADR 0157 decision 6), or else the workspace's `output`. The tool
   has no argument for a folder. With none of the three, it refuses and says to set `output`.
   A preset and a delivery decide their own formats and types, so giving either alongside them
   is refused. Otherwise `formats` narrow the brief's list and `types` default to `png`. The
   destination is not checked against the served folders: the person chose it, as they choose
   `--out` on `tyto render`. Files with the same names are overwritten, as `tyto render` does.
   The job runs with the client's cancellation as its `AbortSignal`, so the frames in flight
   finish and no further frame starts. It uses the session's one Chromium and two frames at a
   time, as `tyto render` does.

8. **Nothing secret leaves through a write either** (ADR 0179 decision 4). The answers are paths
   as the person would type them, hashes, a diff between the agent's own text and a file inside
   the served folders, and located diagnostics.

## Consequences

- An agent's write is a sequence: dry run, read the diff, write with the hash. A host that shows
  tool arguments before a call shows the person the text and the hash being replaced.
- While a window has the folder open, an agent changes a brief that already exists only as a
  proposal, which the person accepts in the editor. An agent served on stdio, with no window
  connection, cannot change such a brief at all. It is told why.
- **What these checks do not close.** The hash is compared and then the file is renamed over,
  so a write by another program in that interval is lost; the interval is one rename. On
  Windows, a rename over a file another program holds open fails, and the tool answers it as an
  internal failure. That the replacement is whole was read in the code, not measured.
- That the window ignores a change on disk to an open brief is a defect of its own, outside this
  ADR. Any editor or `git checkout` that writes the file is erased by the next save. It is the
  card the coordinator opens from this measurement.
