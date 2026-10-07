# 0050 — The desktop runs installed plugins on a Node it carries, pinned to Electron's

Status: accepted · 2026-09-28 · TYTO-186 · amends ADR 0044, extends ADR 0049

## Context

ADR 0049 confined the CLI's plugins with Node's permission model and left the desktop a crash
boundary only (`requireSandbox: false`). The reason was measured: Electron 44.4.1's
`utilityProcess` accepts `--permission` in `execArgv` and does not enforce it. The same
measurement found that Electron run as Node (`ELECTRON_RUN_AS_NODE=1`) does enforce it. Rafael
chose to carry a separate Node binary instead, because that route needs the RunAsNode fuse,
which Electron's hardening guidance says to switch off. That choice was measured before
anything was built, on CI (throwaway draft PR rafaelsilvalor/tyto-archive#254, run 36410437811):

| Platform            | installer without → with Node           | the Node binary | signature on the binary                        |
| ------------------- | --------------------------------------- | --------------- | ---------------------------------------------- |
| Windows, nsis       | 113 059 183 → 136 563 085 B (+22.4 MiB) | 93 580 104 B    | `Valid`, `CN=OpenJS Foundation`                |
| Windows, portable   | 112 892 231 → 136 396 136 B (+22.4 MiB) | (the same)      | (the same)                                     |
| macOS arm64, dmg    | 130 123 014 → 169 320 628 B (+37.4 MiB) | 122 129 232 B   | `Developer ID Application: Node.js Foundation` |
| Linux x64, AppImage | 127 241 257 → 172 372 764 B (+43.0 MiB) | 126 595 440 B   | —                                              |

Run from where `extraResources` put it (`resources/node/`, and inside the extracted AppImage),
it refused a read outside its grant, a child process and a worker, and let a TCP socket through,
on all three. Two more facts:

- **Application Control.** The CI's Windows runner does not enforce user-mode code integrity
  (`UsermodeCodeIntegrityPolicyEnforcementStatus : 0`), so CI cannot measure it. This machine
  does (`: 2`). There, the official signed `node.exe`, copied into a fresh folder, ran and
  enforced. The unsigned `Tyto.exe` is what this machine blocks.
- **Updates.** `dependabot.yml` updates `npm` and `github-actions` only. The npm packages that
  carry Node's binary were ruled out: `node-win-x64` and `node-linux-x64` have one maintainer,
  and there is no `node-darwin-arm64@24`. Changesets sees workspace versions only.

## Decision

### The app carries Node 24.21.0, the Node its Electron embeds

- **`apps/desktop/bundled-node.json` is the pin**: the version and, for each platform the app
  is packaged on (`win32-x64`, `darwin-arm64`, `linux-x64`), the archive's name and sha256 from
  nodejs.org's `SHASUMS256.txt`.
- **`pnpm build` fetches it** (`scripts/fetch-node.ts`), for the platform it runs on, into
  `out/node/`. The archive is checked against the pinned sha256 before anything is extracted,
  kept in `~/.cache/tyto/node/`, and only the binary and its `LICENSE` are kept. The
  destination is `out/` because Turbo caches `out/**` for this package (a cache hit that
  restored the bundles and not the Node would be an app whose plugins cannot start). Every
  packaging runs on the platform it packages: `desktop.yml`'s matrix and `test:package` both
  do.
- **`electron-builder.yml`** excludes `out/node/**` from the asar and ships it as the extra
  resource `node/`. An executable inside an asar cannot be run.

**The version is exactly the Node Electron embeds**, 24.21.0 for Electron 44.4, the same LTS
line the CLI supports (ADR 0049). One version means one set of measurements for both. The
e2e asserts `bundled-node.json`'s version equals `process.versions.node` in main and
`node --version` of the fetched binary. **That test is how an update is seen.** Dependabot never
sees the pin, but it bumps Electron. A bump whose Node differs turns the desktop e2e red on its
own pull request, and that PR does not merge until the pin moves with it. Every pin bump
carries a hand-written changeset for `@tyto/desktop`.

### The plugin's process is a child of that Node, under `--permission`

`bundledNodeLauncher` (`src/main/plugin-process.ts`) replaces `utilityProcessLauncher`. It
forks `out/guest/plugin-guest.js` with the bundled Node as `execPath`, under the CLI's rules:

- `--permission`, and read access only to the plugin's folder and the bootstrap, as real paths;
- an empty environment;
- **a JSON channel**, with each `Uint8Array` crossing as base64 and each `undefined` as a marker
  (`plugin-wire.ts`), because JSON drops an `undefined` key (`activate`'s `config`, which the
  guest's strict schema then refused, measured) and writes `null` for one in an array. The CLI's
  `serialization: 'advanced'` does not work here, measured: it is V8's structured clone, main's V8
  is Electron's and the plugin's is Node's, and every message failed with "Unable to deserialize
  cloned data due to invalid or unsupported version", so no plugin activated;
- the in-guest canary, whose report the desktop's host now requires (`requireSandbox: true`).

The canary file is the app's own `app.asar` in a package and `out/main/index.js` in
development.

- **The bootstrap is its own build**, `vite.guest.config.ts`, into `out/guest/`. electron-vite's
  `main` build shares a chunk between entries, and a chunk beside the bootstrap would have to be
  granted too. It is unpacked from the asar (`asarUnpack: out/guest/**`), because the bundled
  Node is not Electron and cannot read inside one. The same fact closes ADR 0049's asar
  bypass: the process has no asar support to go around the model with.
- **`plugin-guest.ts` and `plugin-process.ts` are the CLI's twins**, copied rather than shared.
  The apps cannot import each other, and the whole of what they share is `runGuest`, which is
  `@tyto/plugin-api`'s.
- **A Node that cannot be started is a crash with a reason**
  (`its process could not start: …`), and the plugin is refused at activation like any other
  process that exits during it.

Development and the desktop e2e run the fetched `out/node/` binary. So the window, the e2e and
the package all run plugins on the same Node. `test:package` proves the packaged path with a
proof line.

### What stays as it was

The network is not confined, for ADR 0049's reason: this Node is 24. The plugins screen's
notice says what is confined and what is not, in both languages. The export, the queue, code
templates (ADR 0048) and directives reach plugins through the same `startInstalledPlugins`, so
nothing else changed for them.

## Consequences

- The installers grow by the table above: about a fifth on Windows and a third on macOS and
  Linux. That is the cost of this choice, accepted.
- **An Electron bump is now two changes**: the Electron version, and the pin with its three
  sha256s. The e2e will not let one land without the other.
- A Tyto for a platform the pin does not list, macOS x64 or Linux arm64 today, fails its build
  with a message naming the platforms that are pinned. Adding one is a line in
  `bundled-node.json`.
- `pnpm build` of the desktop downloads about 32–53 MB once per machine and per version.
- **Not measured**, for want of a certificate:
  - whether notarising with a real Developer ID, which re-signs every binary with the app's
    identity and the hardened runtime, needs an entitlement for Node's JIT;
  - SmartScreen and Mark-of-the-Web on a downloaded installer.
- The RunAsNode fuse is still at Electron's default. The app no longer needs it, and switching
  it off is a hardening card of its own.
  **Done in ADR 0067** (TYTO-193). That required starting the plugin's process with `spawn`
  instead of `fork`, which Electron refuses once the fuse is off; everything above is unchanged.
