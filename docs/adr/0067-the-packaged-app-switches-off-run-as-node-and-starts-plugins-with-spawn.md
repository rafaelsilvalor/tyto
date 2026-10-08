# 0067 — The packaged app switches off RunAsNode, and starts plugins with `spawn`

Status: accepted · 2026-10-07 · TYTO-193 · amended 2026-10-08 by TYTO-241 · amends ADR 0050 (the launcher's mechanism, not its
decision)

## Context

Electron's fuses are bytes in its executable that switch features on or off for good.
electron-builder flips them after it packs the app and before it signs it, so they apply to the
packaged app only. The Electron in `node_modules`, which `pnpm dev` and `test:desktop` run, is
never touched. Until this card `electron-builder.yml` set none, so every fuse was at Electron's
default.

With **RunAsNode** on, `ELECTRON_RUN_AS_NODE=1 Tyto.exe` is a plain Node that any program on the
machine can drive. Electron's hardening guidance says to switch it off. ADR 0050 moved plugins
onto a Node the package carries and said the app no longer needed RunAsNode. **That was half
true, measured**:

- With the fuse off, Electron 44 replaces `child_process.fork` with a function that throws,
  whatever `execPath` it is given. The packaged app's plugins never started:
  `child_process.fork() is not supported when the runAsNode fuse is disabled; use
utilityProcess.fork() instead`, in `tyto.log`, and `test:package` went to 3 failed and 4
  passed out of 7. The three red tests were the `[TYTO-48]`, `[TYTO-189]` and `[TYTO-186]` ones.
- `spawn` is not gated. With an `ipc` slot, `fork` is `spawn` plus a default `execPath` of
  Electron itself, and only that default needs the fuse. Measured on Electron 44.4.5 with the
  fuse off: `fork` threw, and `spawn(node, …, { stdio: [..., 'ipc'], serialization: 'json' })`
  carried a JSON message from the bundled Node and back.
- `utilityProcess` is still not an option. It accepts `--permission` and does not enforce it
  (ADR 0049).

The other fuses were measured against what drives the packaged app.

- `test:package` launches the packaged executable with Playwright's `_electron.launch`.
  `test:desktop` launches the Electron in `node_modules`, where no fuse applies.
- Playwright 1.63 always passes `--inspect=0 --remote-debugging-port=0`. It then waits for
  Node's `Debugger listening on` line, and it deletes `NODE_OPTIONS` from the app's environment.
- The window and the rasterizer load their pages with `loadFile`, over `file://`.

## Decision

### The fuses

The wire of Electron 44 has nine positions. `@electron/fuses` 1.8.0 names eight; the ninth
prints as `fuse8`.

| Fuse                                    | Packaged          | Why                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RunAsNode`                             | **off**           | Nothing in the app runs Electron as Node once plugins start with `spawn` (below).                                                                                                                                                                  |
| `EnableNodeOptionsEnvironmentVariable`  | **off**           | Nothing in the app reads `NODE_OPTIONS`, and Playwright deletes it anyway.                                                                                                                                                                         |
| `EnableNodeCliInspectArguments`         | **on**, kept      | `test:package` launches this executable through `_electron.launch`, which passes `--inspect=0` and waits for the debugger's line. With the fuse off that line never comes, so the launch would wait it out (read in Playwright's source, not run). |
| `GrantFileProtocolExtraPrivileges`      | on, default       | The window and the rasterizer load `file://` pages with `loadFile`. Switching it off means first moving them to a custom protocol, which is a card of its own.                                                                                     |
| `EnableCookieEncryption`                | off, default      | Not measured here. Left open.                                                                                                                                                                                                                      |
| `EnableEmbeddedAsarIntegrityValidation` | **on** (TYTO-241) | electron-builder writes the hash on Windows and macOS, and Electron refuses an archive that no longer matches it. See "Amended by TYTO-241" below.                                                                                                 |
| `OnlyLoadAppFromAsar`                   | **on** (TYTO-241) | The app loads only from `app.asar`. The unpacked guest, `resources/node` and the templates are still reached. See "Amended by TYTO-241" below.                                                                                                     |
| `LoadBrowserProcessSpecificV8Snapshot`  | off, default      | The app ships no snapshot of its own. Nothing to switch on.                                                                                                                                                                                        |
| `fuse8` (unnamed by `@electron/fuses`)  | on, default       | Not named by the library that flips the others, so not flipped. Printed in the proof line, so a reader sees it.                                                                                                                                    |

`electron-builder.yml` sets the first three, and since TYTO-241 the two asar fuses, under
`electronFuses`, with
`resetAdHocDarwinSignature: true`, because flipping a byte breaks the ad-hoc signature an arm64
macOS binary needs to start.

### Plugins start with `spawn`, not `fork`

`bundledNodeLauncher` (`src/main/plugin-process.ts`) is handed `child_process.spawn` instead of
`fork`. Everything `fork` was given is kept:

- the command is the bundled Node;
- `--permission` and the read grants come first in the arguments, then the bootstrap, then the
  plugin's entry and the canary. This is where `fork` put its `execArgv`;
- the environment is empty;
- `serialization` is `'json'`;
- `stdio` is `['ignore', 'inherit', 'inherit', 'ipc']`.

ADR 0050's decision is unchanged: the Node, its pin, the permission model and the JSON channel.
Only the call that starts the process changed.

### The proof

`e2e/packaged.package.test.ts` checks three facts, because the packaged probe alone proves
nothing. A probe whose stdout was never captured also prints no `1`.

1. **Positive control.** The same `probeRunAsNode` runs the Electron in `node_modules`, which no
   fuse has touched, and it must print `1`.
2. **The wire.** The test reads the wire from the packaged executable and asserts the three
   fuses above. It prints every position.
3. **The packaged probe.** `ELECTRON_RUN_AS_NODE=1 <packaged exe> -e "console.log(1)"` must not
   print `1`. It must also still be running at a 15 s deadline, where its whole process tree is
   killed. A Node exits at once, so "still running" is what tells "ignored the variable" apart
   from "never got to answer".

The isolating switches (`--user-data-dir`, and `--no-sandbox` on Linux) are passed only to an
executable whose wire says RunAsNode is off. Node reads options after `-e` too and exits 9 on
`--user-data-dir`, so a probe that always passed it could never see a Node. Putting the
switches behind `--` satisfies Node and loses Chromium, which stops reading switches there.
That was measured the hard way: the packaged app booted into the maintainer's real
`%APPDATA%\Tyto\0.6.0`.

## Consequences

- **Run as Node, the packaged Tyto is no longer a Node.** A program that sets the variable gets
  the app, isolated or not, and no `-e`.
- **The inspect arguments are still honoured.** A local program can start `Tyto.exe --inspect`
  and attach a debugger to main. That is what the test harness needs today. Closing it means
  driving `test:package` without Playwright's `_electron`, through CDP on
  `--remote-debugging-port`, which is a Chromium switch that no fuse gates.
- **An Electron bump can add fuses.** The proof line prints every position, and the wire assertion
  fails if one of the three set here moves. A new fuse shows up as `fuseN` in the log; it is not
  a red test.
- **macOS packaging is not measured by a pull request.** `desktop.yml` packages on macOS only
  for a `desktop-v*` tag. `resetAdHocDarwinSignature` is set from the library's documentation,
  not from a run.
