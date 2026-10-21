# 0113 — The window opens one workspace folder, and keeps it across a relaunch

Status: accepted · 2026-10-21 · TYTO-278 · beside ADR 0080 and ADR 0112, under ADR 0010, ADR 0086
and ADR 0111

## Context

ADR 0112 defined the workspace folder, its `.tyto/project.json` and the resolver. `tyto render`
composes it since TYTO-278's second pull request. The window had no notion of an open folder:
templates came from the `templatesFolder` setting and the built-in and installed packs, a brief's
images from its own folder and `assets/` (ADR 0056, ADR 0057), fonts from one process-wide library
over the machine's folders (ADR 0037), and the export dialog had no default destination at all.

ADR 0080 is closed. The session record it defines takes new optional fields the way TYTO-265,
TYTO-266 and TYTO-286 added theirs, but the reasoning for this one is written here rather than in
that ADR.

## Decision

1. **One workspace folder per window, opened by main.** File ▸ Open Folder runs
   `workspace:set-folder { choose: true }`; main shows the folder picker, reads the folder with
   `loadWorkspace` (trust from `TYTO_HOME/trust.json`, the same `TYTO_HOME` the installed plugins
   use), and keeps it. File ▸ Close Folder is `{ choose: false }`. **No channel takes a path**: the
   request schema is strict, so a request carrying one is refused, not stripped (ADR 0010, ADR
   0086). `workspace:folder` answers what is open: the folder and its name to show, whether it is
   trusted, the output folder, and the project file's diagnostics as problem rows.
2. **What an open folder changes, and for which briefs.**
   - Its **template folders** join the sources after the `templatesFolder` setting and before
     the built-in pack — the order `tyto render` gives a typed `--templates`, then the project's.
     They apply to every brief, as a chosen template folder does.
   - Its **asset folders** are searched after a brief's own folder and `assets/`, and its **font
     folders** before the machine's — **only for a brief whose folder is inside the workspace**.
     A brief elsewhere, or one in no file yet, renders exactly as it did with no folder open. The
     project's stock is the project's.
   - Its **output folder** is the export dialog's destination until the person picks one in this
     window, and the folder the picker opens at.
3. **The session keeps it.** `session.json` takes an optional `workspace: { folder }`, written by
   main from the folder main has open, never from anything the window sent. The version stays 1,
   and a field that does not parse costs the folder alone. Reading the session reopens the folder
   through the same door Open Folder uses, before the tabs come back, so the trust store is asked
   again on every launch and a folder that is gone, or is no longer a workspace, is simply not
   open. A session with no field closes whatever the last page had open.
4. **Its problems are rows in the problems panel**, with the place in `.tyto/project.json` written
   into the message (`…\.tyto\project.json:4:13: …`), because a row's range points into the brief
   in front. A restricted folder's left-out keys are therefore visible from this pull request on,
   before the banner of ADR 0111 exists. The rows are replaced by each workspace answer and
   survive a template read, as a theme's rows do.
5. **Fonts.** One library per set of workspace font folders for the life of the process, with the
   machine's folders after them; the machine's own library is unchanged for every other brief.

## Consequences

- A person opens a project folder and its briefs preview and export with the project's
  templates, images and fonts, and exports land in its output folder by default. Relaunching
  brings the folder back.
- The banner and the Manage Trust command (ADR 0111) are the next pull request; until then a
  restricted folder says what it left out only in the problems panel, and trust is granted by
  editing `trust.json`.
- A font installed into a workspace folder while the app is open is seen after a restart, as a
  machine font is.
- The window does not walk up from a brief to find a workspace, as `tyto render` does: the window
  has a folder the person opened, and a brief outside it is not that project's.
