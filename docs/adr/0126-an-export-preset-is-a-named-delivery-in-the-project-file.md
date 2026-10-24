# 0126 — An export preset is a named delivery in the project file

Status: accepted · 2026-10-23 · TYTO-270 · amends ADR 0112 ("it names places and nothing else")
and adds a row to ADR 0111's table; builds on ADR 0054, ADR 0057, ADR 0074, ADR 0079 and ADR
0114

## Context

ADR 0079 closed user scripts and recorded the need behind the card's example — "export grid and
story into `./entregas` with one key" — as **an export preset, which is data, not a script**.
Until this card the window's export took its formats and folder from its dialog alone, so that
need had no home.

**What exists at `origin/main` fb2b470, read in the code.** `export:start` already takes
`formats`, `outputs` and `directory` from the window, and main delivers into the directory with
`removeLeftovers` and `delivery` on (ADR 0054, ADR 0057). The project file and the work profile
are two sheets merged key by key, with plugin sections merged per plugin id (ADR 0112, ADR 0114).
`keybindings.json` entries are `{ key, command, when? }`: a key names a command id and nothing
else (ADR 0074). The key table is resolved by `resolveWith` in the renderer against the commands
registered at that moment, and **nothing resolved it again when the registry changed**: the recent
files re-register on every listing and only repaint the bar.

## Decision

### Where presets live

**In the project file and in work profiles, layered defaults → profile → folder** — not in
`settings.json`. A preset is about a project's delivery: which sizes a campaign sends and where
they go. Settings are about the editor, and ADR 0112 already keeps them apart from the places a
project names.

This amends ADR 0112's "the file names places and nothing else": **a preset is a named
destination, and its formats are that delivery's spec**. It names a place, like `output`, and
says what is delivered there.

### The shape

An object keyed by name, the key and the form Rafael approved:

```jsonc
"exportPresets": {
  "entregas": { "formats": ["grid-1x1", "story"], "types": ["png"], "folder": "entregas" }
}
```

- `formats`: at least one format name. Required.
- `types`: at least one exporter kind (`png`, `jpeg`, `webp`, `svg`, or an installed plugin's);
  **`png` when left out**, which is what the export box starts with.
- `folder`: optional; where the files go.
- **No `delivery` key.** The window's export always delivers (ADR 0057); a preset that could turn
  it off would be a second export path, not a name for the first.

**Presets merge by name**, as plugin sections merge by plugin id (ADR 0112): a folder that writes
`entregas` replaces the profile's `entregas` whole and inherits the profile's other presets.

### Where `folder` resolves: the declared exception

**`folder` resolves against the open workspace folder, whichever sheet wrote it.** ADR 0112
resolves a relative path against the sheet that wrote it; for a preset that would put a profile's
`"folder": "entregas"` in `~/.tyto/profiles/<name>/entregas`, which no campaign wants. A preset is
a destination _inside the project_, so it is relative to the project.

- Without `folder`, the preset uses the project's resolved `output`.
- With neither, the preset is **withheld** with `W_PROJECT_PRESET_NO_FOLDER` at its name.

**Confinement.** When the workspace folder or the sheet that wrote the preset is restricted, the
folder goes through both of ADR 0112's checks against the **workspace folder**: lexically in
`core`, then after `realpath` in `@tyto/io`. One that leaves is `W_PROJECT_PATH_OUTSIDE` on
`exportPresets.<name>.folder`, and **that preset is dropped**.

### Validation, and why a refused preset does not fall through

Read one entry at a time and tolerant, as every key is (ADR 0073 rule 5), with each diagnostic at
its range in `project.json` or `profile.json`. A value that is not an object, an empty name, a
preset that is not an object, empty or missing `formats` and empty `types` are
`W_PROJECT_KEY_INVALID`; a format or type entry that is not a name costs that entry; an unknown
key inside a preset is `W_PROJECT_KEY_UNKNOWN` and the preset still runs.

**A refused preset is dropped, not fallen through to the profile's preset of that name nor to
`output`.** Unlike a place key, a preset that ran with another sheet's formats or another folder
would deliver the wrong set to the wrong place, and the person would send it. No silent fallback.

A format the brief's template does not declare is found when the preset runs, by the export's
existing diagnostics (`E_UNKNOWN_FORMAT`, `E_FORMAT_NOT_IN_BRIEF`): the project file does not know
which brief will be in front.

### Trust: inert

ADR 0111's table gains a row: **export presets are inert**. A preset only runs the built-in
export, only when the person runs its command, into a folder the confinement allowed. A restricted
folder's presets are offered like its `output` is.

### Running one in the window

- **One command per preset, id `export.preset:<name>`**, registered the way the recent files are,
  because `keybindings.json` takes no arguments. Its title is "Export: <name>" / "Exportar:
  <name>", the name shown as written. It acts on a brief only, like Export… (TYTO-283).
- Main sends the presets in the `workspace:folder` answer, beside `output`, folders resolved.
- Running one calls the existing `export:start` with the preset's `formats`, one output per type
  and its `folder`. No new renderer and no new channel. **The export box opens already running**,
  so progress, problems and the leftovers list are the box's.
- **An existing destination follows ADR 0054**: overwrite by name, remove only what the previous
  `result.json` listed and this run did not produce (`W_LEFTOVER_REMOVED`), never the person's
  own files. A destination that does not exist is made: the delivery's `mkdir -p` of `editaveis/`
  already makes it, measured by the e2e, which starts each run with no `entregas/`.
- **The key table is resolved again after every workspace answer that changed the presets**, when
  a layer above the built-in one exists. Without it, a binding to a preset read before the folder
  opened stayed `W_KEYBINDING_UNKNOWN_COMMAND` until `keybindings.json` was next saved; the e2e
  binds `ctrl+e` before the folder opens and goes red without the re-resolution.

### The command line

`tyto render --preset <name>` is **not built by this card** and reads the same presets when it
is: the preset's `formats` and `types` as `--formats` and `--types`, its `folder` as `--out`
(typed flags win, as `--out` wins over `output` in ADR 0112), delivered the way `tyto render`
delivers (ADR 0057). A missing preset is an error naming the presets that exist.

## Consequences

- A campaign folder (or the profile it names) declares `entregas` once; Ctrl+K → "Export:
  entregas", or one key, writes both PNGs into the campaign's `entregas/`.
- `ResolvedProject.exportPresets` is the resolved list, each with its origin; `projectPaths`
  answers each path with the root it must stay inside, and `leadsOutside` takes that root.
- `ProjectEntry` carries an optional syntax tree (`node`) so nested diagnostics have ranges.
- Not built: the CLI's `--preset`; presets in the File menu; quality and scale per preset (each
  exporter's defaults apply, as in the box before anybody moves them).
- Not measured: a preset whose `folder` is a network drive that disconnects mid-run; it reports
  through the export's existing failure path, which this card did not change.
