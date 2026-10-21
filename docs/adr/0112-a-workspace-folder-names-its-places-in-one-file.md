# 0112 — A workspace folder names its places in one file

Status: accepted · 2026-10-21 · TYTO-278 · builds what ADR 0111 asks of the first card, beside
ADR 0011, ADR 0056, ADR 0057 and ADR 0073; leaves the slot TYTO-347 fills

## Context

Rafael asked on 2026-10-12 for a working folder that describes a project as a whole: where its
images are, which templates and fonts it uses, and where its exports go, so that plugins (Drive,
Jira) can later read the same file to know where things are saved and uploaded.

**What exists at `origin/main` 52fcca9, read in the code.** No workspace folder, project file or
profile. A brief's assets resolve beside it, then in `assets/` beside it, then — for a brief in
`editaveis/` — in `../assets` (ADR 0056, ADR 0057, `briefAssetResolver`). Templates come from a
`templates/` folder (`--templates`, or the window's `templatesFolder`), the built-in pack and
installed packs, in that order. Fonts come from the bundled faces and the machine's font
folders (ADR 0037). `tyto render` requires `--out`. Settings have two layers, defaults and the
user file, and ADR 0073 left the per-folder one out.

ADR 0111 is the gate: a workspace folder is a **source**, it starts restricted, its path keys are
confined to its own real path, its plugin sections are withheld, `core` never reads
`TYTO_HOME/trust.json`, and this card builds the store, the confinement and the withholding. It
also left one risk to this card: a workspace opened at the home directory, whose `.tyto/` is
`TYTO_HOME`.

## Decision

### The file

**`.tyto/project.json` in the workspace folder**, JSON with comments, read with the place of every
key so a diagnostic points at it (ADR 0073's reading). Every key is optional and the file itself
is optional: a folder with no `.tyto/project.json` is a workspace with nothing declared.

| Key         | Value                                  | What it does                                                          |
| ----------- | -------------------------------------- | --------------------------------------------------------------------- |
| `assets`    | list of folders                        | searched after the brief's folder, its `assets/` and `../assets`      |
| `templates` | list of folders                        | searched after a templates folder named on the command line or window |
| `fonts`     | list of folders                        | searched before the machine's font folders                            |
| `output`    | one folder                             | where exports go when nothing else was named                          |
| `plugins`   | object, one section per plugin id      | opaque to Tyto; handed to plugins (ADR 0011)                          |
| `profile`   | a work profile (reserved for TYTO-347) | read, and answered with `W_PROJECT_PROFILE_UNSUPPORTED`               |

A relative folder resolves against the folder that holds the **sheet**, never against the brief:
the workspace for its own file, a profile's own folder for a profile (TYTO-347). Nothing is
decoded, so `%2e%2e` is a folder name.

**Tolerant per key and per entry**, as settings are (ADR 0073 rule 5). A value that is refused
costs that key alone, with a diagnostic at its range, and the key falls through to the sheet
before it or to nothing. A list keeps the entries it accepts; a list whose every entry was
refused counts as not written. A file that does not parse is `E_PROJECT_SYNTAX`, and the keys the
parser recovered around the error still apply. An unknown key is `W_PROJECT_KEY_UNKNOWN`.

**It names places and nothing else.** ADR 0073's per-folder settings layer stays out: a project
file that also set the editor's font size would be two files in one, and ADR 0111 would have to
sort its keys into runnable and inert one by one. If a per-folder settings layer is built later,
it is its own file under `.tyto/`, with ADR 0111's narrower key set.

### Layers, and where a work profile slots in

The resolver, `resolveProject` in `core`, takes a **list of sheets** in order. Each sheet carries
its keys, the folder its paths resolve against, and its own trust answer. Today the list has one
sheet, the workspace's. TYTO-347 adds the profile **before** it, which makes the order for the
places a project names: **defaults → work profile → workspace folder**. Settings stay defaults →
user (ADR 0073); the project file does not take part in them.

**Merging is key by key, the later sheet winning, and a list key is replaced whole, never
concatenated.** This holds for every list key — `assets`, `templates` and `fonts` — and it is
deliberate: a folder that writes `fonts` means those fonts and no others, while a folder that
writes only `output` keeps every list the profile declared. Concatenation would make "use these
fonts instead" impossible to say. **Plugin sections merge per plugin id**, because each plugin's
section is its own key: a profile can set `drive` and a folder `jira`, and the folder's `drive`
replaces the profile's.

### Confinement and withholding, in two halves

ADR 0111's confinement runs twice, once per half of the program that can do it:

1. **Lexically, in `core`.** The resolver joins each value to its sheet's folder and refuses, in
   a restricted sheet, any that lands outside — by `..`, by an absolute path, on Windows without
   case. No disk is read, so this half is a pure function a test calls with either trust answer.
2. **After `realpath`, in `@tyto/io`.** `loadWorkspace` asks `projectPaths` which paths passed the
   first half, follows each through `realpath` (the nearest existing ancestor when the folder does
   not exist yet, since an output folder usually does not), and hands the resolver the answers. A
   junction or a symbolic link inside the folder that lands outside is refused like a `..`.

A refused path is `W_PROJECT_PATH_OUTSIDE` at the key, and the key falls through. A restricted
sheet's `plugins` are withheld whole, with one `W_PROJECT_SECTIONS_WITHHELD` naming the plugins.
Both halves are perturbed separately in the first pull request.

### The trust store

**A port in `core`, `TrustStore`, with three questions**: `trustOf`, `grant`, `revoke`. The
adapter is `fsTrustStore` in `@tyto/io`, over `TYTO_HOME/trust.json` exactly as ADR 0111 shaped
it: one entry per source, keyed by real path in its own spelling, compared without case on
Windows, edited in place so a person's comments survive. A `trust.json` that cannot be read is
`E_TRUST_FILE`, every source is answered restricted, and nothing is written over it.

**Approval is granted by the window**, from the banner on an open folder (the third pull request
of this card), **or by editing the file by hand**. The command line has `tyto trust remove
<folder>` and `--trust` for one run, and no `tyto trust add` yet.

### Which folder is the workspace

- **The window opens one folder per window**, chosen with File ▸ Open Folder and restored on
  relaunch with the session (ADR 0080). That is the third pull request.
- **The command line walks up from the brief's folder** and stops at whichever comes first: the
  first folder holding a `.tyto/project.json`, a folder whose `.tyto` is `TYTO_HOME`, or the root
  of the file system. `tyto watch` does not walk: its tasks are Jacurutu's folders (ADR 0011).
- **`--out` and `--templates` typed on the command line win** over the project file and are never
  confined, because a path the person typed is their choice and not the source's content (ADR
  0111). `--out` is optional when the workspace declares `output`. When it declares none, or a
  restricted folder's `output` was refused, the run stops asking for `--out`, and prints the
  project file's diagnostics first so the refusal explains itself.

### The home directory

**A folder whose `.tyto` is `TYTO_HOME`, compared after `realpath`, is never read as a workspace.**
Its `.tyto/` holds `plugins/` and `trust.json`, and ADR 0111 forbids taking either as a source's
own content. The command line's walk stops there and reads nothing; `loadWorkspace` answers that
it is not a workspace. The folder is not refused as a folder — the window may still show it — but
nothing in its `.tyto/` is a project file. With `TYTO_HOME` set elsewhere the rule follows it.

## Consequences

- **Built in three pull requests**, one package set each: this ADR with `core` and `@tyto/io`
  (the file, the resolver, the confinement, the store); then `tyto render` and `tyto trust
remove`; then the window (File ▸ Open Folder, the session, the banner, Manage Trust).

- `tyto render briefs/promo.brief` inside a workspace needs no `--out`, and finds the project's
  templates, images and fonts with nothing typed. A brief outside any workspace renders exactly
  as before.
- A restricted workspace renders, previews and exports with everything inside its own folder,
  and asks for nothing. Only a key that leads outside, or a plugin section, produces a
  diagnostic — the banner of ADR 0111, and nothing else.
- Plugin sections are resolved and withheld, but no plugin receives one yet: `plugin-api` has no
  door for them. The first card whose plugin reads a section (TYTO-280 or a Drive plugin) adds
  that door and states it in `docs/plugin-api.md`.
- The window keeps its own JSONC reader for `settings.json`, beside the new one in `@tyto/io`.
  Unifying them is a follow-up, not part of this card.
- TYTO-347 adds a profile sheet to the list `resolveProject` already takes and resolves its paths
  against its own folder, with no change to the resolver's signature.
- Not measured: how many font files a project folder may hold before the first measurement of a
  family slows down. The library opens only files whose name starts with the family (ADR 0037),
  as it does for the machine's folders.
