# 0212 — A plugin reads a workspace file in parts and lists a folder

Status: accepted · 2026-11-17 · TYTO-768 · amends ADR 0130 and ADR 0138; builds on ADR 0049,
ADR 0050, ADR 0111, ADR 0112 and ADR 0211

## Context

ADR 0138 gave a plugin `host.workspace.read(path)` and `write(path, bytes)`, each at most
32 MiB (`PLUGIN_FILE_LIMIT_BYTES`) because one answer crosses whole as one message. It left out
a listing on purpose: "listing a person's folder to a plugin is a wider grant than any known
connector needs".

Two things changed. On 2026-11-17 the maintainer described how the work now flows: the designer
works in a local folder, the delivery folder is the source (ADR 0211), and the folder is uploaded
when the piece ships; sheets become reports. TYTO-759 builds that upload as a plugin, and it must
walk a delivery folder it did not write and send each file. The editables it sends measured 30 to
120 MB, over the ceiling of one read.

## Decision

**`host.workspace` gains a part, a stat and a list.** `read` keeps its whole-file form and its
32 MiB ceiling; the other three are new:

| Call                                            | Resolves to                                                 |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `host.workspace.read(path, { offset, length })` | at most `length` bytes from `offset`, of a file of any size |
| `host.workspace.stat(path)`                     | `{ name, kind: 'file' \| 'folder', size, modifiedAt }`      |
| `host.workspace.list(path = '')`                | the entries of one folder in the same shape, sorted by name |

A part is short at the end of the file and empty past it, so a plugin reads until it gets an
empty part or has read `stat`'s size. `offset` and `length` are whole numbers of bytes, zero or
more, and `length` is at most `PLUGIN_FILE_LIMIT_BYTES`: the ceiling stays on one message, never
on a file. **The advised part is 8 MiB** (`PLUGIN_FILE_PART_BYTES`): a multiple of the 256 KiB
step a resumable upload expects, and small enough that the plugin, the wire and the host each hold
one part. The host reads a part through an open handle at its offset into a buffer the size of the
part, so a 100 MB file is never in memory whole.

`modifiedAt` is ISO 8601 from the host's clock, as `storedAt` is (ADR 0138). A folder's `size` is
`0`. `''` (or `.`) names the open folder itself for `stat` and `list`; `read` still refuses it.
`list` goes one level deep; a walk lists each folder it finds.

**`list` answers at most 10,000 entries** (`PLUGIN_FOLDER_LIST_LIMIT`). A folder holding more is
refused with `E_WORKSPACE_FILE`, never cut short, because a list missing entries reads as a whole
one. The adapter stops reading the folder at the first entry past the ceiling.

**All three sit under `workspace:read`; no new permission.** This reverses ADR 0138's sentence
quoted above. Reading any path by name is already a wider grant than seeing names: a plugin with
`workspace:read` that guesses `entrega/capa.psd` gets the file's bytes, and one that may list
learns only that the file is there. A separate `workspace:list` would add a line to the grant
prompt and protect nothing a reader cannot already reach. The permission's wording in the desktop
is unchanged.

**Confinement is ADR 0138's, reused.** `checkedCapabilities` checks the path lexically (no
absolute path, no drive, no `..`), and the adapter confines it again after `realpath`, refuses a
restricted folder with `E_WORKSPACE_FILE_RESTRICTED` before looking at the path, and reads the
folder and its trust on every call. In a listing, **a link that leads out of the folder is left
out**, and one that stays inside is described by what it leads to; a link that leads nowhere is
left out too. Refusing the whole folder for one such link would let a stray junction break an
upload, and leaving it out shows the plugin nothing it could read.

**The wire.** Three requests, `workspaceReadPart`, `workspaceStat` and `workspaceList`, and
`RPC_PROTOCOL_VERSION` 27, because a host on 26 refuses them as unknown capabilities. A part
crosses the desktop's JSON channel with the `$tytoBytes` marker (ADR 0050), and the CLI's channel
natively. The host rebuilds each entry field by field, so an adapter's extra keys never cross,
and `checkedCapabilities` refuses an adapter that answers more bytes than the part asked for or
more entries than the ceiling.

**Hosts.** The desktop and every CLI command with a workspace get the three ports from
`workspaceFiles` in `@tyto/io`; `tyto watch` still has no workspace and answers
`E_WORKSPACE_FILE`. The MCP server gives plugins no workspace files and is untouched.

## Consequences

- TYTO-759 can walk a delivery folder and upload a 100 MB editable in 8 MiB parts with memory
  bounded by the part (measured in `workspace-files.test.ts`: 13 parts, a rise of about 16 MiB in
  live array buffers, against about 116 MiB when the adapter was made to read the whole file).
- A plugin that may read the workspace may now learn its file names, sizes and dates. The grant
  prompt says `workspace:read` as before; nothing tells a person that this now includes a listing
  beyond this record and the plugin manual.
- A folder with more than 10,000 entries cannot be listed. No known delivery folder comes close;
  paging is a later card if one does.
- A part is a snapshot of one moment: a file changed between two parts uploads torn. The plugin
  compares `stat`'s `modifiedAt` and size before and after, if it cares.
