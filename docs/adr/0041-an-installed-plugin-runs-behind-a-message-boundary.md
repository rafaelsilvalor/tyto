# 0041 — An installed plugin runs behind a message boundary, and the boundary is not a sandbox

Status: accepted · 2026-09-27 · TYTO-48 · extends ADR 0007 and ADR 0040 · amended by ADR 0049,
which runs the CLI's plugins in a child process under Node's permission model

## Amended by ADR 0049

"The boundary is not a sandbox" is no longer true of the CLI, since 2026-09-28. An installed
plugin runs in a child process started with `--permission` and read access to its own folder and
its bootstrap only, not in a worker thread, which was measured not to be narrower than the
thread that starts it. Its process proves it is confined before its code is imported, and the
host refuses it with `E_PLUGIN_SANDBOX` otherwise. `RPC_PROTOCOL_VERSION` is 2. The network
stays advisory on the Node versions the project pins: `net:` still filters `host.fetch` and
nothing else. The message boundary, the proxy, the crash handling and `crashes.json` below all
stand.

## Context

ADR 0007 says each plugin runs in a process of its own with the host as a proxy. Until this card
an installed plugin's module was imported with `import()` into Tyto's own process (ADR 0040): an
uncaught throw in it was Tyto's crash, and the object it held was the real `PluginHost`.

Four questions had to be answered before the boundary could exist, and each shaped more than the
card:

1. `Exporter.exportFrame` answered synchronously, and nothing that crosses a thread or a process
   can.
2. A contribution is data and functions, and only data can be cloned into a message.
3. The two ends of the messages are built separately — a worker bundle, a `utilityProcess`
   script — and can disagree.
4. A `worker_threads` worker runs on the same Node, with the same modules available to it, as
   the thread that started it.

## Decision

### The host is a proxy, and every message is checked where it lands

`@tyto/plugin-api` declares the protocol (`isolation/protocol.ts`, Zod), the port an app
implements (`PluginChannel` and `GuestChannel`: send, hear, hear that the other end is gone), the
guest (`runGuest`, the only `PluginHost` an installed plugin holds) and the host side
(`connectIsolatedPlugin`). All four are pure; `apps/cli` implements the channel on
`worker_threads`, and `apps/desktop` will on `utilityProcess`.

**Each side validates what it receives.** The host parses every guest message and every answer a
guest's function returns; the guest parses every host message and checks a call's arguments
against the point's schema before the plugin's code sees them. A guest that answers something
the schema refuses gets `E_PLUGIN_PROTOCOL` on that frame, never a value nobody checked.

**The guest is activated once, and the host replays it.** A guest answers `activate` with what
it registered; `connectIsolatedPlugin` returns an ordinary `Plugin` whose `activate` registers
proxies of those contributions into whichever host it is given. So an isolated plugin goes
through `tryActivate` like any other, and every check TYTO-47 put on that door (the manifest,
the name, duplicate ids, undeclared points) applies without being written twice. The CLI builds
a host per task; the thread behind them is one per plugin per command.

### What crosses: data, and functions by handle

A contribution crosses as data; each function in it stays in the guest and crosses as a
`{ $call: n }` handle the host calls back. **A function is callable only if its point names it**,
with the schema for its arguments and the schema for its answer (`isolation/points.ts`). In this
card the only callable is `exporter.exportFrame`. `template-pack`, `editor.command` and
`editor.keymap` are data only.

`source`, `sink` and `rasterizer` carry a value whose type lives in a Node package and whose
methods nothing here names. `directive` and `panel` are behaviour, not data, and their shape is
TYTO-49's. **All five are refused by name** when an isolated plugin registers one ("not
available to an isolated plugin yet"), so a plugin learns which point, rather than registering
something no host could call. TYTO-49 lifts the refusal for `directive` and `panel` by adding
their callables to the same table.

### `exportFrame` may answer later

`exportFrame` returns `Result | Promise<Result>`, and the job awaits it. The built-ins still
answer on the spot and did not change.

**Rejected: a synchronous call over `Atomics.wait`.** A `SharedArrayBuffer` and `Atomics.wait`
would let the host block until a worker answers, and would have kept the old signature. It works
for `worker_threads` and not for Electron's `utilityProcess`, which shares no memory with main.
The desktop half would then need a second mechanism, and the contract would still have to change
there.

### The protocol has its own version

Every message carries `protocol: 1` (`RPC_PROTOCOL_VERSION`). It is separate from the engine:
the engine says which host contract a plugin was written against (ADR 0040), and a plugin never
sees these messages. The guest's first message is `hello` with its number, and it is the only
message read before that number is compared. A mismatch refuses the plugin at activation
(`E_PLUGIN_ACTIVATE`, naming both numbers).

### A crash is data, and history

When a plugin's process ends and the host did not end it, every call waiting on it — and every
call after — answers `E_PLUGIN_CRASHED`, in the shape the caller expected. That code, like
`E_PLUGIN_CALL` (the plugin's function threw) and `E_PLUGIN_PROTOCOL`, **is not fatal** (ADR
0025): it costs the frames that were waiting on the plugin, and the frames other exporters draw
are delivered.

The CLI records the crash in **`crashes.json`, beside `plugins.json` and never inside it**, as
`{ at, reason }` per plugin. The CLIs already shipped read `plugins.json` with a strict schema,
and the CLI and the desktop are versioned separately: one new key there would make the older app
on the same machine refuse the file and load no installed plugin at all. `crashes.json` has its
own schema, and only `plugin list` reads it. **A crash does not stop the plugin from activating
on the next run**, because a crash can be caused by the input and not the code. `plugin list`
shows the status `crashed` with its time as a `W_PLUGIN_CRASHED` line, and `install`, `enable`
and `remove` clear it.

### `plugins.json` drops the keys it does not know

From this version on, `plugins.json` is read with a tolerant schema: **an unknown key is dropped,
not refused**, at the root and in each entry. That is what lets the next field be added without
repeating the problem above. What an older app drops, it also does not write back, so a newer
app's field survives only until an older app next writes the file. `crashes.json` is tolerant
from its first version.

### The boundary is not a sandbox

**A worker thread is a crash and API boundary, not a security boundary.** The plugin's code runs
on the same Node as Tyto's and can `import('node:fs')` or open a socket itself. What the thread
buys is that a crash is the thread's, and that everything the plugin asks _of Tyto_ crosses as a
checked message. `net:*` permissions filter `host.fetch` and nothing else, and a plugin that
reaches around `host.fetch` is not stopped. The install prompt says so in as many words. It
replaces TYTO-47's notice rather than adding a second one.

`host.fetch` and `host.credentials` are the second half of TYTO-48, in their own pull request.
Until it lands the prompt still says the permissions are "recorded and shown, and not yet
enforced", and that is still true.

A real boundary — a child process started with Node's permission model — is TYTO-186.

## Consequences

- `@tyto/plugin-api`'s `Exporter` contract changed: a caller of `exportFrame` awaits it. Below
  1.0 that is a minor bump (ADR 0040), and the job is the only caller in this repository.
- An installed plugin can contribute only exporters, template packs, editor commands and keymaps
  until the other points gain callables.
- A plugin whose function never answers keeps its frame waiting. There is no call deadline yet.
- `plugins.json` is unchanged in shape, so every CLI already shipped still reads it. The
  `PluginStore` port gains `readCrashes` and `writeCrashes`.
- A field added to `plugins.json` from now on is lost when an older app rewrites the file, which
  happens on `install`, `remove`, `enable` and `disable`. A field that must survive that belongs
  in a file of its own, the way the crash history does.
