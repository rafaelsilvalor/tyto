# 0049 — An installed plugin runs under the runtime's permission model, and the network stays advisory

Status: accepted · 2026-09-28 · TYTO-186 · amends ADR 0041, extends ADR 0042, ADR 0044 and ADR 0048

## Context

ADR 0041 put each installed plugin behind a message boundary and said in as many words that
the boundary was not a sandbox. A plugin's code ran on Tyto's Node, in a worker thread in the
CLI and in a `utilityProcess` on the desktop, and could `import('node:fs')` or open a socket
itself. `net:` and `credentials:` filtered `host.fetch` and `host.credentials` (ADR 0042) and
nothing else. So an approved permission list described what a plugin said it would do, not
what it could do.

Node has a permission model: `--permission`, with `--allow-fs-read=<path>` and the other
`--allow-*` flags. It has been stable since v22.13.0 and v23.5.0, and the engines range is
`^22.22.2 || ^24.15 || >=26`. It was measured before anything was designed, with a probe
plugin that reads a file outside its folder, opens a TCP socket, spawns a child and starts a
worker. It was measured on this machine (Node 24.15, Electron 44.4.1, which embeds Node 24.21),
and on CI in a throwaway workflow (draft PR #254, closed, run 36410437811) on Node 22.23.2 and
24.20, on Linux, Windows and macOS:

| Where                                                            | read outside | TCP     | child   | worker  |
| ---------------------------------------------------------------- | ------------ | ------- | ------- | ------- |
| Node 22 and 24, child process with `--permission`                | refused      | allowed | refused | refused |
| worker thread, same flags in `execArgv`, parent unrestricted     | **varies**   | allowed | refused | refused |
| Electron 44 `utilityProcess.fork`, same flags in `execArgv`      | allowed      | allowed | allowed | —       |
| Electron 44 run as Node (`ELECTRON_RUN_AS_NODE=1`), same flags   | refused      | allowed | refused | refused |
| Node 24.21.0 bundled in the packaged app, from `resources/node/` | refused      | allowed | refused | refused |

Four things in that table decided the design.

- **Two runtimes accept the flags and do not enforce them, silently.** A `utilityProcess`
  reports the flags in `process.execArgv`, has no `process.permission`, and reads anything.
  A worker thread refused a read outside its grant from 2 of 6 working directories on this
  machine, repeatably, while a child process refused from 6 of 6. On CI the worker refused.
  Node's documentation says the model "does not inherit to a worker thread". A test that
  checked only the refused spawn would have gone green on both.
- **No network permission exists before Node 25.** `--allow-net` was added in v25.0.0,
  Stability 1.1, and takes no host: it is all or nothing. Every supported Node the project
  pins is 22 or 24. So is Electron 44's.
- **A grant on a linked path refuses the process its own entry.** On macOS the temporary
  folder is under `/var`, a link to `/private/var`. A child granted `/var/folders/.../plugin`
  failed before its first line with `ERR_ACCESS_DENIED`, `resource: '/var'`: Node resolves the
  entry's real path and needs to read the link.
- **Three things get through the model.** A junction inside the granted folder is followed out
  of it. Under Electron-as-Node, a file inside any `.asar` is readable, because Electron's asar
  hook reads it without asking the model (`ELECTRON_NO_ASAR=1` closes that, and setting
  `process.noAsar = false` afterwards does not reopen it). And `process.env` is not confined at
  all, while the CLI's holds every plugin's `TYTO_PLUGIN_*` credential.

## Decision

### Each installed plugin runs in a child process under `--permission`

The CLI starts each installed plugin with `child_process.fork`, not in a worker thread. The
process gets `--permission` and read access to exactly two paths: the plugin's installed folder
and the bootstrap it starts from. Nothing else is granted. It cannot read outside its folder,
write anywhere (its own folder included), start a process or a worker, load an addon, or use
the inspector or WASI. Messages cross the IPC channel with `serialization: 'advanced'`, so
`host.fetch`'s body is still a `Uint8Array`.

- **The bootstrap is one self-contained file**, `dist/guest/plugin-guest.js`, with
  `@tyto/plugin-api` and everything it imports inlined. A bootstrap that resolved
  `@tyto/plugin-api` out of `node_modules` would need the store granted, and a grant on the
  store would be a grant on every package on the machine. It is a second `tsup` build.
  `yaml` needs a `createRequire` banner there, because it calls `require('process')`. Tests
  start the same bundle, built once per run by `vitest.guest-setup.ts`.
- **Every granted path is its real path**, and so are the module paths the child is given.
- **The environment is empty.** On Windows, libuv adds back its eleven required variables
  (`HOMEDRIVE` … `WINDIR`, measured). None of them is Tyto's or a plugin's.
- **An uncaught throw still names its reason.** A process that dies of one exits with a code
  and no message, where a worker handed its host the error. The bootstrap sends `{ fatal }` to
  the launcher first, and the launcher keeps it as the crash's reason. It is the adapter's
  message, not the protocol's, and never reaches `connectIsolatedPlugin`.

### The process proves it is confined before the plugin's code exists

The bootstrap tries to read a file that exists and that the grant does not cover: the CLI's
own bundle, which the launcher passes as an argument. **It does this before the plugin's
module is imported, and the answer crosses in `hello`** as
`sandbox: { runtime, canary, detail }`:

- `denied`: the read failed with `ERR_ACCESS_DENIED`, the only proof that the model is
  enforcing. The file is known to exist, so the refusal cannot be a missing file.
- `readable`: the process is not confined.
- `failed`: any other outcome, `ENOENT` included, named in `detail`.

A host that requires the sandbox refuses anything but `denied`, and a `hello` with no report,
with `E_PLUGIN_SANDBOX`. The diagnostic names the plugin and the runtime. It comes **per
plugin, at activation**, before the host sends `activate`, so nothing of the plugin's is ever
imported. `requireSandbox` is an explicit option of `connectIsolatedPlugin` and of
`startInstalledPlugins`: the CLI passes `true`.

**A version number is not the check.** The launcher reads
`process.allowedNodeEnvironmentFlags.has('--permission')` only to decide whether it can pass
the flag at all. A Node that does not know the flag would otherwise refuse to start. A Node
without it starts the child with no flags, the canary reads its file, and the plugin is refused
by the same path as any other unconfined runtime. Node 22 lists both `--permission` and
`--experimental-permission`, and 24 only the first. So the flag spelling is the same on both,
and the canary is the proof on both.

**Rejected: one canary per process, in a separate child.** It would prove a sibling started
with the same flags, and cost a process start. The canary in the plugin's own bootstrap proves
the exact process that will run the plugin, at no extra start, before its code exists.

`hello` gained a required field, so `RPC_PROTOCOL_VERSION` is **2**. A bootstrap left behind by
an upgrade meets ADR 0041's mismatch refusal, not a schema error about a new key.

### Links are refused at load, not only at install

`install` already refused a link that leads out of the plugin's folder (TYTO-50,
`E_PLUGIN_LINK`). A folder can change after it was installed, and the model follows a link, so
`startInstalledPlugins` asks the store again before every start (`PluginStore.linksLeaving`).
The plugin cannot make one itself while it runs: it can neither write nor start a process.
`E_PLUGIN_LINK`'s message no longer says "install", because it is now said at load too.

### What stays advisory, said plainly

- **The network.** On Node 22 and 24, and on Electron 44's Node, a plugin that imports
  `node:net` or `node:http` reaches any host. `net:` permissions filter `host.fetch`, which is
  checked per host on the host's side (ADR 0042), and the bootstrap still deletes the global
  `fetch`. On Node 25 and later, `--permission` without `--allow-net` refuses every socket the
  plugin opens itself. There `host.fetch` is the only way out, so `net:` is enforced per host.
  This ADR does not move the project to Node 25, a line without long-term support, for it. The
  CLI's test asserts whichever of the two the running Node does.
- **`credentials:`** was never a runtime question: a credential is only ever handed across by
  `host.credentials`, and the empty environment removes the other path.

The install prompt says what is confined and what is not, in those words. The acceptance
criterion "a raw socket to an undeclared host is refused" is met where the runtime can enforce
it and declared advisory where it cannot.

### The desktop

Until the second TYTO-186 pull request, the desktop passes `requireSandbox: false`. Its
`utilityProcess` guest reports `canary: 'failed'` honestly and is a crash boundary only, as
ADR 0044 describes. The second pull request starts plugins on a Node 24 binary bundled with
the app, which enforces the model from where the package puts it (the table above). It pins
that Node in a file of its own to the Node Electron embeds (24.21.0 today), with a test that
turns red when the two drift apart. Dependabot updates only `npm` and `github-actions`, so it
never sees the pin. It does bump Electron, and that bump turns the drift test red. Every bump
of the pin carries a hand-written changeset. The installer grows by 22.4 MiB on Windows,
37.4 MiB on macOS and 43.0 MiB on Linux (the same run). Rafael chose this over
`ELECTRON_RUN_AS_NODE`, which Electron's hardening guidance says to switch off.

## Consequences

- Measured on this machine, three runs of 20: a plugin's start, from `fork` to activated, has a
  median of 195 ms (p90 210–240 ms), against 269 ms for the worker thread it replaces. The
  worker loaded an unbundled `.ts` under Vitest and the child loads one bundled file, so this
  says the change is not slower, not that it is faster. The canary itself is one refused
  `readFileSync`: 10–13 µs.
- A plugin can no longer read its own `node_modules` outside its folder, write a cache, or spawn
  a helper. A plugin bundles what it needs into its folder, which `docs/plugin-authoring.md`
  already asked of a code template and now asks of every plugin. One that reads files the person picked has to receive them through the host, and
  no such point exists yet.
- The bootstrap is 2.88 MB, because it inlines `@tyto/core` and its dependencies.
- An installed code template (ADR 0048) runs in the same process, so it is confined the same
  way. Its test reads a file beside its plugin and gets `E_PLUGIN_TEMPLATE` wrapping
  `ERR_ACCESS_DENIED`.
- A plugin whose `console` writes to stdout still reaches the CLI's stdout, as it did from a
  worker thread.
- `PluginProcessRequest` gained `directory`, and `PluginStore` gained `linksLeaving`, in
  `@tyto/plugin-api`. Below 1.0 that is a minor bump (ADR 0040).
