# 0201 — The panel's built-ins touch files, inside the workspace folder only

Status: accepted · 2026-11-15 · TYTO-537 · epic E20 · amends ADR 0200 decision 1 (no built-in
writes a file), decision 3 (what a registry entry gives) and decision 5 (the working folder) ·
builds on ADR 0111, ADR 0113, ADR 0115 and ADR 0121

## Context

ADR 0200 gave the command panel a registry of built-ins and left two seams for the file commands
(TYTO-537): a registry entry per command, and one working folder per session that `cd` would
change. The maintainer asked for commands that "travel through folders, list items, create
items": `ls`, `cd`, `pwd`, `cat` to read, and `new`, `mkdir`, `mv`, `cp`, `rm`, `open`, `reveal`
to change the folder or act on a file, with `rm` going to the bin only and a restricted folder
allowing the reading ones only.

ADR 0200 said no built-in writes a file, and every path the panel reads is a step in the
explorer's listings. File commands need both rules restated: what a built-in may reach, how a
typed path becomes something main acts on, and where the boundary is checked.

## Decision

### 1. A typed path is steps under the workspace root, found in the explorer's listings

A file command's path is read against the session's working folder (`command-paths.ts`): empty
steps and `.` are skipped and `..` goes back one. It is refused, before anything is listed, when
it starts at a root (`/`, `C:\`, `\\server`) or at `~`, or when a `..` would climb above the
workspace root. A `..` that stays inside is allowed, unlike in a glob (ADR 0200 decision 4):
`cd ..` is how a person walks back.

Each step is then found by name in the explorer's listing of the folder above it
(`explorer:list`, ADR 0113), so what the panel reaches is what the explorer shows, by the ids main
minted. The explorer resolves every entry to its real path before it lists it and leaves out one
that leads outside the open folder (ADR 0115), so a symbolic link or a junction pointing out is
not a step: `cd` into it answers that no such folder exists.

### 2. Main checks every id it is handed; the window is not the boundary

A file command hands main an id, never a path, and main checks it again at the call: the id must
be one it minted for the open folder, and its path, resolved to its real path now, must still
lie inside the open folder. An entry that became a link out after it was listed is refused
there. This is how `explorer:open`, `explorer:image` and the explorer's writes already work
(ADR 0115, ADR 0121), and every channel the file commands add or extend does the same.

### 3. `cd` changes the session's working folder; `tyto` commands run there

`cd <folder>` sets the session's working folder (ADR 0200 decision 5) to the folder's steps, with
the names as the disk has them; `cd` alone goes back to the root. Nothing else changes it, and
opening another workspace folder sends every session back to its root.

The prompt shows it: `tyto ›` at the root, `tyto entregas/novembro ›` under it, so where the next
command runs is on the line it is typed on. A `tyto` command runs in it: `cli:run` takes an
optional `folder`, the explorer id of the working folder, and main runs the command with that
folder as its `cwd` only after decision 2's check, through `explorer.folderOf`; an id that fails
it starts nothing. A working folder deleted or renamed since is refused in the window too, with
a line that says `cd` goes back to the root.

**Trust stays the workspace's, not the folder's.** A command finds its workspace from its `cwd`
upwards (ADR 0112), so a command run in a subfolder of a restricted folder is restricted exactly
as at the root, and the window's refusals (ADR 0159 decision 2, TYTO-726) are asked with that
`cwd` and apply as they do at the root. A subfolder that holds its own `.tyto/project.json` is a
workspace of its own, with its own trust, as it is for a command run there from a terminal.

Paths a run prints link relative to the folder it ran in (`CommandRun.folder`), so a click on
`cartaz.brief` printed after `cd entregas` opens `entregas/cartaz.brief`.

### 4. The reading commands run in a restricted folder; the writing ones do not

`ls`, `cd`, `pwd` and `cat` read names and text and run nothing, so they run in a restricted
folder (ADR 0111), as the explorer lists one. `new`, `mkdir`, `mv`, `cp`, `rm`, `open` and
`reveal` say they do not (`runsInRestrictedFolder: false`), and the panel refuses them there with
the line that names Workspace: Manage Trust (ADR 0200 decision 3).

- `ls [path]` lists a folder, folders first, as the explorer orders them: a folder's name ends in
  `/`, and each name is followed by its kind — folder, brief, recipe (a `.recipe`), or file. A
  file a tab opens is a link in the output; past the explorer's cap of 2,000 a note counts the
  rest.
- `pwd` prints the working folder as an absolute path, with the open folder's own separator.
- `cat <file>…` prints text files through `explorer:read`: by id, a file only (a folder's id is
  refused), decoded as UTF-8, refused as binary when a NUL byte is among the bytes read, and
  read up to 256 KB, with a note when the file was longer. Text only, never bytes.

### 5. The writing commands go through the explorer's own operations

A file command that changes the folder (TYTO-537's second part) does it through the same
main-side functions the explorer's New, Rename and Delete use (ADR 0121), and their IPC where one
exists: there is no second way to write in the renderer or in main.

- `new <name>` makes an empty file and `mkdir <name>` a folder, with `explorer:create`'s name
  rules, never overwriting anything. `new <name>.brief --template <t>` writes the skeleton the
  explorer's New Brief and `tyto delivery new -t` write, or the option is left out until that
  skeleton can be shared.
- `mv` and `cp` take a source and a target inside the workspace, never overwriting.
- `rm` moves an entry to the operating system's bin (`shell.trashItem`) and nothing else: a bin
  that fails leaves the entry where it was, and nothing is ever deleted for good.
- `open` opens a file in a tab as the explorer does (`explorer:open`); `reveal` selects an entry
  in the explorer.

Each still runs no program: ADR 0200 decision 1 holds for everything but the sentence that no
built-in writes a file, which this decision replaces.

## Consequences

- `cli:run` gains `folder`; `explorer:read` is a new channel. Both are strict and take ids.
- The manual's Commands page lists the file commands and says the prompt shows the folder.
- Completion offers paths after a file command, from the working folder (folders only after
  `cd`), and completes a `tyto` command's paths from there too.
- A name `ls` prints with a space in it is not a link: the output's links are found by a pattern
  that ends a path at a space (TYTO-496).

## Rejected

- **Paths crossing to main.** Main has the folder and could resolve a typed path itself, but the
  window would then name paths (ADR 0010, ADR 0113), and confinement would be a second copy of
  the explorer's. The ids already carry it.
- **Refusing every `..`.** Safe, but `cd ..` is the one way back up a folder a person knows; a
  `..` is refused only where it would leave the root, which needs no listing to tell.
- **Trusting a subfolder on its own.** Trust is given to a workspace folder (ADR 0111); a `cd`
  that changed what a command may run would make the panel a way around Manage Trust.
- **Deleting for good with `rm -f` or a confirmation.** The explorer's Delete has no permanent
  form either (ADR 0121); the bin is the undo.
