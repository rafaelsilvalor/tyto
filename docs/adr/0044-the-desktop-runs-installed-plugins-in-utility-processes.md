# 0044 — The desktop runs installed plugins in utility processes, and the queue stays PNG-only

Status: accepted · 2026-09-27 · TYTO-48 · extends ADR 0041 and ADR 0042 · amended by ADR 0049,
which measured that a `utilityProcess` does not enforce Node's permission model

## Amended by ADR 0049

A `utilityProcess` accepts `--permission` in `execArgv` and does not enforce it: the process
reads any file, opens sockets and spawns children, measured on Electron 44.4.1. Since ADR 0050,
each plugin runs on a Node 24 binary the app carries, pinned to the Node its Electron embeds,
under the same model as the CLI, and the desktop's host requires the sandbox.

## Context

ADR 0041 and ADR 0042 built the isolation for the CLI and left the desktop's half behind. That
half had four parts:

- a `utilityProcess` adapter for the same port;
- activation in the window, which until now only listed installed plugins (TYTO-47);
- credentials through `safeStorage`, the one place `CLAUDE.md` allows secrets on the desktop;
- `crashed` on the plugins screen.

Two facts about the app shaped it. First, the export dialog and the IPC schema both closed the
exportable kinds to `png`, `jpeg`, `webp` and `svg`, so an installed exporter could never be
asked for. Second, the queue panel (TYTO-45) renders through the export service with a fixed
`[{ kind: 'png' }]`, so it would never ask for an installed kind, however it was activated.

## Decision

### One loader, two compositions

The CLI's loader moves into `@tyto/plugin-api` as `startInstalledPlugins` (`installed.ts`),
next to `readInstalledPlugins`, `writeCrash` and `activateInstalled`. It takes ports only:

- the `PluginStore`;
- `launch`, which starts a plugin's process;
- `entryOf`, which says where a plugin's `dist/index.js` is and whether it exists;
- the `HostCapabilities`;
- for activation, the app's answer to which kinds a rasterizer encodes.

The CLI keeps its names as thin wrappers, and its existing tests pass unchanged. The desktop's
plugins screen reads through the same `readInstalledPlugins`. The two apps differ only in what
they compose.

### The desktop's composition

- **A `utilityProcess` per plugin**, forked from `out/main/plugin-guest.js`, the second main
  bundle, with the plugin's module path as its one argument. The guest is `runGuest` over
  `process.parentPort`, and it deletes the global `fetch` as the CLI's worker does. `fork` is
  injected, so the adapter is tested without Electron.
- **Started when the window opens, not awaited.** A plugin whose activation hangs costs its
  30 s activation deadline (ADR 0042) to the first export, never to the window. A store that
  cannot be read is logged, and the app runs without installed plugins.
- **Activated into every export's host after the built-ins**, with the same refusals as the CLI:
  `W_PLUGIN_SKIPPED` in the run's diagnostics, and `E_PLUGIN_EXPORTER_KIND` for a rasterized
  kind no rasterizer encodes.
- **The kind is open.** `export:start` takes any non-empty kind, and `runJob` refuses one that
  no registered exporter produces, naming the ones that exist. `export:kinds` answers with every
  kind a run could produce, from the same host shape a run builds. The dialog offers that list
  and falls back to the built-in four until the answer arrives.
- **`net.fetch`**, Electron's, with `redirect: 'manual'`. It is an Electron API, not the
  `fetch` global, so it needs no lint exception, and it uses the system's proxy.
- **Credentials only through `safeStorage`**, as the account `plugin:<name>:<key>` in the
  existing credential store, behind the same `credentials:<key>` gate. There is no environment
  fallback. The app has no screen to store such a credential yet (TYTO-187). Until it does, a
  declared key answers `E_CREDENTIAL_MISSING`, and the message says that this version has no
  screen to store one.
- **A crash** is recorded in `crashes.json` by the shared loader, and the plugins screen shows
  the plugin as `crashed`, with the `W_PLUGIN_CRASHED` sentence `tyto plugin list` prints.

### The queue stays PNG-only, by decision

The queue asks the export service for `png` and nothing else, and this ADR keeps that. Adding
every installed kind would silently change what every inbox task produces the day somebody
installs any exporter. A folder meant to be picked up unattended should not change without being
asked. `tyto watch` chooses its kinds with `--types`, so the parity fix is a per-folder choice:
TYTO-188.

What this card proves about the queue is that the installed plugins are **activated in its
host**: a refused plugin is named in the task's `result.json`.

## Consequences

- Both apps start plugins, record crashes and activate the same way, because the code is one.
- A plugin installed while the window is open is started the next time the window opens. The
  plugins screen says so (`plugins.inactive`, en and pt-BR), replacing the sentence that the
  window runs no installed plugins.
- The export dialog can offer a kind Tyto does not know. It offers such a kind as a document
  kind: `quality` and `scale` reach only `png`, `jpeg` and `webp`.
- Only `test:package` on CI proves that a plugin outside `app.asar` loads in a packaged build.
  This machine's Application Control blocks a newly packaged exe.
