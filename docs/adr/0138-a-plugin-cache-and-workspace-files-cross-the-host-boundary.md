# 0138 — A plugin's cache and workspace files cross the host boundary as six checked requests

Status: accepted · 2026-10-25 · TYTO-371 · completes ADR 0130 · builds on ADR 0042, ADR 0049,
ADR 0111, ADR 0112, ADR 0117, ADR 0118 and ADR 0134

## Context

ADR 0130 decided that a plugin gets a private cache kept by the host and reaches the open
workspace's files only through the host, and left the shape to the card that builds it. The
connectors need both: raw answers from Jira and Google, big and changing by the minute, and
the tables a person decides to keep, in the project. ADR 0134 is the pattern for a plugin
writing through the host: optional ports on `HostCapabilities`, one check in
`checkedCapabilities`, a refusal naming the host when a port is absent, a new protocol number.

This record settles the API, the permissions, the ceilings, the codes and the on-disk layout.
TYTO-371 lands in three pull requests: the API and the codes (`@tyto/plugin-api`,
`@tyto/core`), the adapters (`@tyto/io` and the CLI), and the desktop.

## Decision

**The plugin's face.** `host.cache` and `host.workspace`, beside `host.fetch` and
`host.credentials`:

| Call                                          | Resolves to                                         |
| --------------------------------------------- | --------------------------------------------------- |
| `host.cache.get(key)`                         | `{ bytes: Uint8Array, storedAt }` or `undefined`    |
| `host.cache.put(key, bytes \| string)`        | `{ storedAt }`                                      |
| `host.cache.delete(key)`                      | `true` when there was an entry, `false` otherwise   |
| `host.cache.list(prefix = '')`                | `{ key, storedAt, size }[]`, keys starting `prefix` |
| `host.workspace.read(path)`                   | `Uint8Array`                                        |
| `host.workspace.write(path, bytes \| string)` | `null`                                              |

A string is stored as its UTF-8. `storedAt` is an ISO 8601 instant **from the host's clock,
never the plugin's**: it is what the notebook shows as a table's age (ADR 0130), and a plugin
could otherwise make stale data look fresh. There is no `workspace.list` yet; a connector
names the files it keeps, and listing a person's folder to a plugin is a wider grant than any
known connector needs.

**Permissions.** The workspace needs `workspace:read` and `workspace:write` in the manifest,
neither implying the other; an undeclared one is `E_PERMISSION` and the grant prompt shows both
like any other permission. **The cache needs none**: it holds only what the plugin put there,
keyed by the plugin's name, so no plugin reaches another's entries. For the same reason **the
cache works under a restricted folder** (ADR 0111): it holds nothing the folder ships.

**The ports.** `HostCapabilities` gains six optional members, each taking the plugin's name
first: `cacheGet`, `cachePut`, `cacheDelete`, `cacheList`, `workspaceRead`, `workspaceWrite`,
and an optional `hostName` the refusals use. A host without a cache port answers
`E_PLUGIN_CACHE` ("this host keeps no cache for plugins"); without a workspace port,
`E_WORKSPACE_FILE` ("tyto watch gives plugins no workspace files"; both examples corrected on
2026-10-25, see the note below). Every call goes through `checkedCapabilities` (ADR 0042), in
process and across the isolation boundary alike.

**Ceilings, checked in `checkedCapabilities` and again by the adapters.** A key, and a list
prefix, is a string of at most **1 KiB in UTF-8** (`PLUGIN_CACHE_KEY_LIMIT_BYTES`); a key may
not be empty, a prefix may. A cache entry, and a workspace file read or written, is at most
**32 MiB** (`PLUGIN_FILE_LIMIT_BYTES`): one answer crosses whole as one message, and the bound
is on that message. An adapter's answer over it is refused too, so a misbehaving adapter cannot
push one across. **The cache as a whole has no ceiling**, as ADR 0130 left it.

**Paths.** A workspace path is relative to the open folder. `checkedCapabilities` refuses,
lexically, an empty path, a control character, an absolute path or a drive, a `..` segment and
the folder itself, and hands the adapter the path `/`-separated with `.` segments dropped. The
adapter confines it again **after `realpath`**, as ADR 0112 confines a project's places, so a
link inside the folder that lands outside is refused. **A write into `.tyto/` is refused even in
a trusted folder**: that folder holds the workspace's own configuration, and a plugin rewriting
`project.json` would be rewriting what the person trusted. The lexical check compares the first
segment without case and without trailing dots or spaces, as Windows resolves it; the adapter
compares after `realpath`. Reading `.tyto/` is not refused.

**The folder and its trust are read on every call**, never fixed at activation: a person opens
another folder or trusts this one while the plugin is running, and the next call sees it. A
restricted folder answers `E_WORKSPACE_FILE_RESTRICTED`; no folder open is `E_WORKSPACE_FILE`.

**Three codes.** `E_PLUGIN_CACHE` `{ plugin, key, problem }`: an empty or oversized key, an
entry over the ceiling, a host without a cache. `E_WORKSPACE_FILE` `{ plugin, path, problem }`:
outside the folder, through a link, missing, too large, inside `.tyto/`, no folder open, a host
without a workspace. `E_WORKSPACE_FILE_RESTRICTED` `{ plugin, path }`, apart because its remedy
is different: trusting the folder lets the same call through.

**The isolation protocol is 6.** A guest's `request` gains six capabilities, which a host on 5
would refuse as unknown; a bootstrap left behind is refused by name at `hello` (ADR 0049).
Bytes cross as the protocol's other bytes do — a `Uint8Array` by structured clone in the CLI,
`$tytoBytes` on the desktop's JSON wire (ADR 0050). A miss and a write answer `null`, because
that wire drops `undefined`; the guest turns the miss back into `undefined`. Each answer is
rebuilt field by field on the host's side and checked against a strict schema on the guest's,
so nothing an adapter adds — a path, above all — reaches the plugin.

**On disk.** `TYTO_HOME/cache/plugins/<plugin>/<sha256(key)>.bin`, with a `.json` sidecar
`{ key, storedAt, size }` that `list` reads without opening the entries. Hashing the key keeps
any key a valid file name on every system and keeps it from naming a path. Writes are atomic,
a temporary file renamed over the entry, sidecar after bytes, so a reader sees the old entry or
the new one and never half of either.

**The CLI implements both** in `tyto render`, with the folder `findWorkspace`
found and its trust, `--trust` counting for the run. **`tyto watch` gets the cache only**: an
inbox is filled unattended and has no folder a person opened and trusted (ADR 0118), so its
workspace port is absent and the refusal names `tyto watch`. The desktop implements both
against the folder open in the window.

## Consequences

- A connector keeps Jira's raw answers between runs without a project ever holding them, and
  writes a table into the project only through a call the host saw and could refuse — the
  plan ADR 0129 describes.
- The plugin process keeps ADR 0049's sandbox: no `--allow-fs-write` is added.
- A plugin can fill the cache without bound. A ceiling is a later card if a measured cache
  grows, as ADR 0130 said.
- An entry over 32 MiB, or a key over 1 KiB, needs a new ADR, not a bigger constant.
- A file a plugin writes into `.tyto/` has to be written by the person instead.

## Note, 2026-10-25 — the example refusal, the sidecar's digest and the desktop (TYTO-371)

The example refusal for a host without a cache named `tyto watch`, which contradicted the
decision two sections down: `tyto watch` has the cache and refuses only workspace files. The
example now names no command for the cache and `tyto watch` for the workspace, as the code does.

The sidecar is `{ key, storedAt, size, sha256 }`. Two processes putting one key with bytes of
the same size could leave one's bytes beside the other's sidecar, and the size could not tell;
`get` hashes what it read and answers a miss when the digest differs. `list` still compares
only the size, so it never opens an entry: such a pair is listed and then missed, as an entry
deleted between the two calls would be. A sidecar written before the digest fails the schema
and is a miss, because nothing tells its bytes apart from a race's; the next `put` replaces it.

The desktop's end-to-end suite found the race was not hypothetical: an export runs its frames
at once, each frame's plugin call put the same key, and on Windows the second rename onto the
entry failed with `EPERM` (4 of 9 runs). One host now writes an entry in turn — a put or a
delete of a key waits for the one before it — and a rename Windows calls busy (`EPERM`,
`EACCES`, `EBUSY`) is tried again for about two seconds before it is thrown. Two hosts, the
desktop and a `tyto render`, still share no turn; the retry lands both puts and the digest
judges what is left.

The desktop composes both ports for its installed plugins, with the cache in the `TYTO_HOME`
the plugins live in and the workspace read from what the window has open at each call, a
trust taken back counting until the folder is reopened (ADR 0111). Its refusals name
`Tyto desktop`, and the plugins screen says in words what `workspace:read` and
`workspace:write` reach.
