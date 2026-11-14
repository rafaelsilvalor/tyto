# 0197 — A plugin file source may be a `.zip`, over https or on the machine, and needs no git

Status: accepted · 2026-11-04 · TYTO-562 · amends ADR 0151 (source shape and lock), under ADR 0011, ADR 0117 and ADR 0127

## Context

A plugin file names each source as `{ git, ref }` and fetches it with the person's own `git`
(ADR 0151 decision 5). Tyto ships no Git, so a machine without it cannot load even a public
template. On 2026-11-04 Rafael asked for three ways to load templates and plugins:

- **https** for what is public, a repository's tag archive downloaded as it is;
- **Drive** for what is private to the company, through a plugin source (TYTO-564);
- **a `.zip` on the machine**, for a copy handed around by hand.

OneDrive is out for now. This ADR covers the first and the third, which are one mechanism: a
`.zip` read from a location. The gallery writing such sources, and reading its own index over
https, is a follow-up card (ADR 0162 is unchanged here).

## Decision

### 1. A source is `git` or `archive`, never both

```yaml
templates:
  tabela:
    source:
      archive: https://git.example.com/templates/tyto-template-tabela/archive/refs/tags/{ref}.zip
      ref: v1.2.0
  local:
    source: { archive: ./packs/local-{ref}.zip, ref: v1 }
```

`archive` is an https URL or a path on this machine; `./` and `../` are relative to the plugin
file's folder, as a git path is. `{ref}` stands for the ref, so the gallery's update, which
moves only `ref` (ADR 0162 decision 6), moves an archive too. The location must end in `.zip`
once the ref is in place. Over the network only `https://` is read: a `.zip` fetched in clear
could be swapped on the way before the lock ever pinned it, and a redirect that leaves https is
refused for the same reason. A ref spliced into a location may not hold `/`, `\`, `?`, `#` or
`..`, so it cannot reach another folder or another host. Tyto names no host (ADR 0127): the URL
is data the person or the gallery writes.

### 2. The lock pins an archive by the sha256 of its bytes

```json
{ "archive": "https://…/{ref}.zip", "ref": "v1.2.0", "sha256": "…64 hex…", "plugin": "tabela" }
```

An archive has no commit to name, and its bytes are what must not change under the person.
A git entry is written exactly as before, key for key, so an existing lock is the same bytes.
The cache is `TYTO_HOME/cache/plugin-files/<sha256(archive)>/<first 40 hex of sha256(bytes)>/`,
staged and renamed into place (ADR 0117 point 4). Forty, not sixty-four, so an archive's copy
is no deeper than a commit's and the longest path TYTO-470 measured under `TYTO_HOME` still
holds; the lock keeps the whole sha256. A cached copy is therefore the pinned one, and a sync
asks nothing for it, and a home too deep fetches no archive either, as it fetches no commit. A pinned archive fetched again whose bytes hash to anything else is
refused with `W_PLUGIN_FILE_FETCH`, saying both hashes, and nothing from the new bytes loads;
only `tyto plugin sync --update` takes them. That is what makes a re-tagged release visible
instead of a changed render.

### 3. The `.zip` is read by Tyto, with the limits a tag archive needs

`readZip` in `@tyto/io` reads stored and deflated entries with Node's `zlib`, no dependency.
It refuses Zip64, encryption, links, absolute names, drive letters, backslashes, `..`, two
names Windows reads as one, more than 64 MB packed and more than 256 MB expanded. When every
entry sits under one top folder, as a host's tag archive puts them (`repo-v1.2.0/`), that
folder is dropped, so the manifest is at the copy's root as in a git checkout.

### 4. The download is the runtime's own `fetch`, behind a seam

`syncPluginFolder` takes an optional `download`, `downloadOverHttps` when absent. That
function is alone in `packages/io/src/archive-download.ts`, the only file of `@tyto/io` the
lint lets use `fetch` (`boundary/io-archive-download`), as the CLI's `host.fetch` adapter is. Tests inject
one, so no test reaches the network. No credential is sent: a private plugin goes through the
Drive source, never through a token in a URL.

## Consequences

- A machine without Git loads every archive source; git sources work as before.
- `PluginFilesCopy` names `location` and `pin` instead of `git` and `commit`, since a copy may
  be either kind; `tyto plugin list` prints the location and the pin in the same columns, and
  its JSON says `archive` and `sha256` for an archive.
- `E_PLUGIN_FILE_SOURCE_REFUSED` says what the source resolved to, `commit …` or
  `archive sha256 …`, instead of always `commit`.
- The gallery still lists and installs git sources only; an archive source in a plugin file is
  never one of its entries until the follow-up card.
- `git`'s proxy configuration does not apply to an archive: the runtime's `fetch` reads none.

## Rejected

- **`.tar.gz`.** Rafael asked for `.zip`, which a host serves for every tag as well, and which
  a person can make by hand on any system.
- **A URL per version, with no `{ref}`.** The gallery's update would have to rewrite the URL,
  which ADR 0162 decision 7 keeps to one scalar.
- **Pinning by the URL alone.** A tag can be moved and its archive changes with it; the bytes
  are the only thing that says what was rendered.
- **A zip library.** The format a tag archive uses is small, and every check above is ours to
  make whichever library reads it.
