# 0114 — A work profile is one sheet that many folders name

Status: accepted · 2026-10-21 · TYTO-347 · fills the `profile` slot ADR 0112 reserved, under ADR
0111; amends the `profile` row of ADR 0112's table

## Context

Rafael asked on 2026-10-21 for **work profiles**, and chose their meaning: a reusable project
sheet. A profile such as "Saúde" names the asset, template and font folders, the output folder
and the plugin sections that many campaign folders share. Each folder's `.tyto/project.json`
names its profile and overrides only what differs. Without it every campaign folder copies the
same sheet, and changing the vertical's fonts means editing every copy.

**What exists at `origin/main` e1611a3, read in the code.** TYTO-278 merged in four pull requests
(#134, #135, #137, #138). `resolveProject` in `core` already takes a list of sheets, each with its
kind (`folder` or `profile`), the folder its relative paths resolve against, its entries and its
own trust answer. It merges them key by key, the later sheet winning, and **replaces a list key
whole** (ADR 0112). That is decided and not reopened here. `project.json` reads a `profile` key and
answers it with `W_PROJECT_PROFILE_UNSUPPORTED`. ADR 0111 already says how a profile passes trust:
one inside `TYTO_HOME` is trusted by where it lives, one anywhere else is its own source, and
trust never travels along a reference.

What was left to decide: how the key names a profile, how deep profiles go, how a missing one
reads, and where its files and its trust come from.

## Decision

### Two ways to name a profile

`"profile"` takes a string in one of two forms. Which form is decided by the text alone, before
any disk is read, so the same file means the same thing on every machine.

- **A name**, such as `"saude"` or `"Saúde"`. It is the profile the person keeps at
  **`TYTO_HOME/profiles/<name>/profile.json`**, so `~/.tyto/profiles/saude/profile.json`. A
  folder per profile, not a file per profile, so the profile's own `assets/` or `fonts/` can sit
  beside it and its relative paths have a folder of their own to resolve against.
- **A path**: anything holding a `/` or a `\`, or ending in `.json`. It is resolved against the
  workspace folder, like every other path key (ADR 0112). A path to a folder means the
  `profile.json` in it, so `"../team/saude"` and `"../team/saude/profile.json"` are one profile,
  laid out like a named one. `"saude.json"` is therefore the file beside the project, never a
  profile called `saude.json`.

**A name is strict.** It becomes one folder name under `TYTO_HOME/profiles/`, so it may not climb
out of that folder or mean something else to the file system. It is refused with
`W_PROJECT_PROFILE_INVALID` when it starts with a dot, holds `..`, holds a character no Windows
folder name may hold (`< > : " | ? *` or a control character), ends in a space or a dot (which
Windows drops), is a device name Windows reserves (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
`LPT1`–`LPT9`, with or without an extension), or is longer than 64 characters. Accents and spaces
are allowed: "Saúde Concursos" is a name. **Names compare without case on Windows** and with case
elsewhere, because the profile is found by the file system and that is how each one finds a
folder. Tyto does not fold case itself.

### One level only

A profile's own `profile` key is ignored, with `W_PROFILE_NESTED` at that key in the profile's
file. A chain (profile extends profile) would need an order, a cycle check and a way to say which
of three files a value came from, and no case has been measured that needs it. If one appears, a
new ADR adds the chain; nothing here has to change shape for it, because the resolver already takes
a list.

### Order, and what a folder overrides

**Defaults → work profile → workspace folder**, as ADR 0112 placed the slot. Key by key, the
folder winning; a list key replaced whole; plugin sections merged per plugin id. A folder that
writes only `output` keeps every list the profile declared. Settings stay defaults → user (ADR
0073); neither sheet takes part in them.

**Relative paths in a profile resolve against the profile's own folder**, never against the
workspace that names it. `"fonts": ["fonts"]` in `~/.tyto/profiles/saude/profile.json` is
`~/.tyto/profiles/saude/fonts` for every campaign.

`ResolvedProject` now says **where each value came from**: `origins.assets`, `.templates`,
`.fonts` and `.output` are `profile` or `folder` (absent for a key no sheet set), and
`origins.sections` does the same per plugin id. A key the folder wrote but had refused falls
through, and its origin is the profile's. This is what the window shows; where it shows it is the
next pull request of this card.

### Trust, applied to both forms

ADR 0111 holds as written. What this ADR adds is how each form meets it.

- **A named profile is trusted by where it lives**, in a trusted or a restricted folder alike,
  because the person wrote it into `TYTO_HOME` and anybody who can write there can already plant a
  plugin. A restricted folder may name one: the name can only reach `TYTO_HOME/profiles/`.
- **A profile path is a path key, so a restricted folder's is confined to the folder.** It is
  checked twice, as every path key is (ADR 0112): lexically in `core`, then after `realpath` in
  `@tyto/io`, on the profile file itself, so a `profile.json` that is a link out of the folder is
  outside too. A path that leads out is `W_PROJECT_PATH_OUTSIDE` at the `profile` key, and the
  folder opens with its own keys. Otherwise an untrusted folder could pull any `profile.json` on
  the disk, and the assets and fonts it names, into an export the person then shares.
- **A trusted folder may name a profile file anywhere, and that profile is its own source.** It is
  asked of `trust.json` on its own, keyed by the **profile file's** real path, not its folder's,
  so two profiles in one team folder are approved one by one. Until it is approved it is
  restricted: its path keys are confined to the profile's own folder, after `realpath`, and its
  plugin sections are withheld. A profile file inside `TYTO_HOME`, named by path, is trusted by
  location like a named one.
- **The command line's `--trust` covers every source the run reads, the folder and its profile.**
  This is a choice the person makes by typing the flag for that run, not trust travelling from the
  folder to the profile: without the flag each is answered on its own. It is never written down.
  `tyto trust remove <file>` takes a profile file's approval back, as it does a folder's.

### A missing or broken profile

The folder always opens. A profile that is not there is `W_PROJECT_PROFILE_MISSING` at the
`profile` key, naming the file that was looked for. A value that is neither form is
`W_PROJECT_PROFILE_INVALID` there. A profile file that does not parse is `E_PROJECT_SYNTAX` in the
profile's own file, and the keys the parser recovered still apply, as for a project file. Every
diagnostic about a profile's contents points into the profile's file, and every diagnostic about
the choice of profile points at the key in `project.json`. `W_PROJECT_PROFILE_UNSUPPORTED` is
gone.

### What a profile may hold

The same keys as `project.json` (ADR 0112): `assets`, `templates`, `fonts`, `output`, `plugins`.
ADR 0011 still holds: a profile names places, and plugins interpret their own sections. ADR
0111's table gains no row, because a profile ships nothing a project file could not.

## Consequences

- Built in two pull requests. This one: this ADR, `core` (`profileReferenceOf`, the origins, the
  codes), `@tyto/io` (`loadWorkspace` reads the profile layer with its own trust answer and its own
  confinement), `tyto render` and the command-line pages of the manual. The next one: the window —
  a banner line naming a restricted profile on its own (ADR 0111), the profile's problems in the
  problems panel, and where a value came from.
- Until the window's pull request lands, the window already resolves a folder's profile, because
  it calls the same `loadWorkspace`; it does not yet show the profile's own problems or name a
  restricted profile in the banner.
- Two campaign folders naming `"saude"` share its templates, images, fonts and output folder; one
  that writes `"output": "out"` exports there while the other keeps the profile's.
- Not built: making a profile from the window, switching a folder's profile with a click, and
  granting a profile file's trust from the command line (`tyto trust add` does not exist for
  folders either, ADR 0112).
- Not measured: how a profile shared from a synchronised folder (Drive, OneDrive) behaves when the
  file is replaced while a window has it open. The window reads the profile when it opens the
  folder, as it reads `project.json`; a change is seen on the next open.
