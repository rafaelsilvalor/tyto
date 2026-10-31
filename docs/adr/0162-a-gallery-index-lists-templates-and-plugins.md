# 0162 — A gallery index lists templates and plugins; the CLI installs and updates from it

Status: accepted · 2026-10-30 · TYTO-503 · builds on ADR 0011, ADR 0127, ADR 0145 and ADR 0151

## Context

E18 moved the production templates into repositories of their own, which a plugin file names
by `git` and `ref` (ADR 0151). Finding one meant knowing its URL. On 2026-10-30 Rafael asked
for a gallery of templates and plugins, as Obsidian has, and decided three things, recorded
here and not reopened:

- **The gallery reads a maintained list**: an index file in a repository somebody curates,
  like Obsidian's community list. Never a search of a hosting service.
- **Install writes the entry into the plugin file** in the person's Tyto folder
  (`TYTO_HOME/plugin-files/`), pinned to a tag.
- **A newer version is shown and waits for a click.** The art never changes by itself.

This card is the non-visual half: the index's format, reading it, and the CLI's verbs. The
window's gallery is TYTO-504; the curated repository is TYTO-505.

**What exists at `origin/main` cd5e075d, read in the code.** Plugin files, their lock and the
decision of which folder wins a name are `@tyto/plugin-api`'s, pure (`plugin-files.ts`).
Reading a folder, running `git` and the cache are `@tyto/io`'s (`plugin-files.ts`,
`plugin-files-sync.ts`). `tyto plugin sync` resolves a source with no lock entry, or one whose
`git` or `ref` changed, and moves nothing else without `--update`. The CLI never reads the
window's `settings.json` (ADR 0145 decision 5).

## Decision

### 1. The index is `index.yaml` at the root of a git repository

```yaml
version: 1
entries:
  - id: tabela # what `tyto gallery install` takes
    kind: template # or plugin
    name: Tabela
    description: A table in one image.
    source: { git: https://git.example.com/templates/tyto-template-tabela.git }
    latest: v1.2.0 # the tag install pins and update moves to
    templates: [tabela] # the names the manifest declares; a template entry only
    configurations: [roxo] # offered, for the gallery to show
    preview: previews/tabela.png # relative to the index repository
    engine: '>=0.4.0' # the plugin API it needs, as tyto-plugin.json's engine
    changes: Wider first column. # what latest changes: the text an update shows
```

YAML, as plugin files and manifests are, and read the way a plugin file is: **tolerant per
entry**. A refused entry costs that entry alone, with `E_GALLERY_INDEX_ENTRY` at the value that
is wrong; an unknown key is `W_GALLERY_INDEX_KEY_UNKNOWN`; an index that does not parse, or is
not `version: 1`, lists nothing (`E_GALLERY_INDEX_SYNTAX`). `id` is lowercase letters, digits,
`-` and `_`, because it also names a plugin's file. A `git` or `latest` that starts with `-` is
refused, as in a plugin file, because both reach `git` as arguments. A second entry with an id
already listed is refused. `parseGalleryIndex` in `@tyto/plugin-api`, beside the plugin files'
reader, so the CLI and the window read one index the same way.

**What describes a new version is `changes`**, one line the curator writes for `latest`. Tyto
shows it beside "update available" and after an update. It reads no release notes of a
hosting service, because it knows none (ADR 0127).

### 2. The source is a git location the person names; no default here

The index is fetched with the person's `git` as plugin files are (ADR 0151 decision 5): any
location their `git` reads, their credentials, `GIT_TERMINAL_PROMPT=0`, and **no provider
named** (ADR 0011, ADR 0127). A private list works when their `git` can read it. It is read at
the repository's **default branch**, not a tag: the list is what is meant to move. What is
pinned is each entry's tag, in the plugin file.

Only `index.yaml` is read out of the fetched commit (`git show FETCH_HEAD:index.yaml`); nothing
of the index repository is checked out.

**The gallery adds no process path** (ADR 0159). The index is fetched through the same `git`
runner `@tyto/io`'s plugin-file sync uses, and install and update hand the machine's folder to
that same sync, so a fetched plugin's permissions are asked through `CliEnvironment.confirm`
(or taken from `--yes`) exactly as `tyto plugin sync` asks them. Nothing here prompts on its
own, and nothing runs `npm`.

In the CLI the location is `--index <git>`, or `TYTO_GALLERY_INDEX` when that is absent. **Not
`settings.json`**, which the CLI never reads (ADR 0145 decision 5); the window's own setting is
TYTO-504's. **There is no built-in default in this card**: which list a machine trusts is a
choice, and the curated repository does not exist yet. TYTO-505 creates it and may add the
default.

_Amended 2026-10-31 (TYTO-506):_ TYTO-505 made the curated index, and the gallery now falls back
to it. `DEFAULT_GALLERY_INDEX` in `@tyto/plugin-api`, beside `parseGalleryIndex`, names it as a
plain git location (`https://github.com/rafaelsilvalor/tyto-gallery.git`), fetched like any
other, with no provider's API behind it (ADR 0011, ADR 0127). It lives in the pure package
because it is one value two readers start from: the CLI reads `--index`, else
`TYTO_GALLERY_INDEX`, else this default, and a blank value falls through as an unset one does;
the window's built-in setting `galleryIndex` (not `gallery.index`: a dot in a built-in key reads
as a plugin's prefix) defaults to the same value. Neither reads the other's configuration
(ADR 0145 decision 5). It is only a default: which list a machine trusts is still the person's
choice, made with either override, and a private list works as before.

### 3. The cache is the copy fetched last

Every `tyto gallery` command fetches, because each is something a person typed. The text lands
in `TYTO_HOME/cache/gallery/<sha256(index)>/index.yaml`, written beside its name and renamed
into place (ADR 0117 point 4). When a fetch fails, that copy is read and
`W_GALLERY_INDEX_OFFLINE` names the failure and when the copy was fetched. An index never
fetched lists nothing, with `E_GALLERY_INDEX_FETCH`: no other list stands in for it.

### 4. Installed and update available are read from the machine's plugin files and lock

`galleryStatus` in `@tyto/plugin-api` reads every file of `TYTO_HOME/plugin-files/` and the
lock beside them:

- **Installed**: some file holds the entry's repository: for a template entry, a template under
  one of the names it declares whose `source.git` is the entry's; for a plugin entry, a file's
  `plugin.source.git`. **Whichever file**: an entry written by hand before the gallery existed
  is installed. Two spellings of one repository, with or without a trailing `/` or `.git`, are
  one repository; nothing else is normalised. A template of the same name from another
  repository is not this entry.
- **Update available**: some place pins a ref other than `latest`. It is listed with its
  `changes` and **waits**: only `tyto gallery update` moves it. A render, a sync or a start
  never does (ADR 0151 decision 3).
- **Not synced**: the lock does not pin that `git` and `ref` yet. Listed beside the state.
- **Needs a newer Tyto**: `engine` does not admit this Tyto's `PLUGIN_API_VERSION`, by the rule
  `tyto-plugin.json`'s `engine` uses (`satisfiesEngine`). The entry is **listed and never
  installed**: install answers `E_GALLERY_ENGINE` and writes nothing. The fetched manifest is
  checked again at load, as every plugin is (ADR 0151 decision 6).

The project's plugin files are not read: the gallery installs for the machine.

### 5. Install writes one entry, pinned, then syncs

- A **template** entry is added to `TYTO_HOME/plugin-files/gallery.yaml`, made when absent,
  one key per name the entry declares, `source: { git, ref: <latest> }`.
- A **plugin** entry is a file of its own, `TYTO_HOME/plugin-files/<id>.yaml`, because a
  plugin file holds one plugin (ADR 0151 decision 2). An existing file of that name is
  refused, never replaced.
- An entry already installed, in any file, **is not written again**: install says which file
  holds it at which ref, and that `tyto gallery update` moves it when an update is available.
- A template name another file already holds from another repository is refused
  (`E_GALLERY_WRITE`): two entries of one name in one folder load from neither
  (ADR 0151 decision 7).

Then the machine's folder is synced as `tyto plugin sync` does without `--update`, so the new
source is fetched, locked, and approved by `--yes` or at the terminal.

### 6. Update moves the ref where the entry lives, then syncs

`tyto gallery update <id>` moves every place that pins a ref other than `latest` to `latest`,
in the file that holds it, then syncs. An entry no file holds is `E_GALLERY_NOT_INSTALLED`.

### 7. The person's file is spliced, never rewritten

Both writers change **one span of the file's own text**: install inserts the new entries after
the last entry of `templates:`, indented as that file indents its entries; update replaces the
ref's scalar and nothing else, so a comment beside it stays. **A YAML library's
`toString` is not used**: measured on `yaml` 2.9, it rewrites `key:   value`, two blank lines,
a list written at its key's indentation, a flow mapping's spacing and a comment aligned by
hand. After each splice the file is read again, and every entry the edit did not mean to change
must read as it did before; otherwise the edit is refused with `E_GALLERY_WRITE` and the file
is not written. A `templates:` written inline (`templates: { … }`) is refused rather than
reformatted. Files are written beside their name and renamed into place.

### 8. An entry changed by hand is never moved without saying so

`TYTO_HOME/plugin-files/gallery.json` records, per entry id, every place the gallery wrote:
file, template, `git` and `ref`. It is JSON, so the plugin files' reader, which reads `*.yaml`,
never takes it for a plugin file. It sits beside the files so it travels with them.

- A place the record names whose `git` or `ref` is no longer what the gallery wrote **was
  changed by hand**: update refuses with `E_GALLERY_ENTRY_EDITED`, naming what it wrote and
  what it found, and writes nothing in any file. `--force` moves it anyway.
- A place the record does not name **was written by hand**, before the gallery or beside it.
  Update moves its ref, because the person asked by name, and **says so first**, naming the
  file and both refs. From then on the record names it.
- A record that is missing or unreadable is empty: every place then reads as written by hand,
  which is the side that says so.

Every place is checked before any file is written, so a refusal leaves every file as it was.

## Consequences

- `@tyto/plugin-api` gains `parseGalleryIndex`, `galleryStatus`, `sameRepository`,
  `addTemplateEntries`, `moveEntryRef` and `newPluginFileText`, all pure. `@tyto/io` gains
  `fetchGalleryIndex`, `readGalleryRecord`, `writeGalleryRecord` and `writeFileAtomically`.
  `@tyto/command-line` gains `tyto gallery list | install | update`.
- Ten diagnostic codes, all non-fatal: nothing they stop can draw a frame.
- The window's gallery (TYTO-504) composes the same functions; it needs the preview image out
  of the fetched commit, which this card does not read.
- A curator who forgets to bump `latest` leaves everybody on the old tag. A tag removed upstream
  fails the next sync, as any plugin file's would.

## Rejected

- **Searching a hosting service** (repositories tagged `tyto-template`, say). Rafael ruled it
  out, and it would name a provider in Tyto (ADR 0127).
- **An HTTP URL for the index.** Tyto would need an HTTP client with its own auth for a private
  list; `git` already has the person's.
- **Moving refs automatically, or on `tyto plugin sync --update`.** A render would change
  because a curator bumped a tag, which is what Rafael's third decision forbids.
- **Writing the plugin file through `yaml`'s `Document`.** Measured above: it rewrites the
  person's layout.
- **Marking the gallery's entries with a comment in the YAML.** A comment is what a person
  edits or deletes first; the record lives in a file the tool alone writes.

## Amendment, 2026-10-31 (TYTO-504)

**The operations moved from the CLI into `@tyto/io`**, so the window's gallery runs the same
code `tyto gallery` does, as decision 2 already required of the sync. `readGallery`,
`installGalleryEntry` and `updateGalleryEntry` (`gallery-operations.ts`) answer what happened
as data and print nothing; `tyto gallery` formats an outcome as lines, the window as a card's
state. **Neither syncs**: each caller runs the sync it already owns afterwards, so a fetched
plugin's permissions are still asked through `CliEnvironment.confirm` at a terminal and in
the window's own box.

**The previews are read out of the fetched commit**, as the Consequences above anticipated,
only when the caller asks (`fetchGalleryIndex(…, { previews: true })`; the window does, the
CLI does not). Each `preview` is checked out on its own (`git --literal-pathspecs checkout
FETCH_HEAD -- <path>`, bytes as committed) and kept beside the cached index in
`previews/`, so an offline window still shows them. A `preview` that is not a relative path
inside the repository (absolute, a drive, a backslash, a `..`, `.` or empty segment, a dash
first) is never handed to `git`; a picture the commit lacks costs that picture alone, and the
entry is listed without one.

**The window's gallery (TYTO-504, second half)** reads the index the `galleryIndex` setting
names, in main, on every open; the renderer names no index and no path, only an entry's id.
Install and update are the operations above, followed by the window's own plugin-files sync,
so approvals use its box and failures reach its problems panel. **The window has no
`--force`**: a place changed by hand since the gallery wrote it is refused there, and the
refusal names `tyto gallery update <id> --force` for a terminal.
