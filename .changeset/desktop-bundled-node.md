---
'@tyto/desktop': minor
---

Run each installed plugin on a Node the app carries, confined to its own folder (TYTO-186,
ADR 0050). The app ships Node 24.21.0, the Node its Electron embeds, at `resources/node/`.
The version and each platform's sha256 are pinned in `bundled-node.json`, and `pnpm build`
fetches it from nodejs.org. A plugin's process is a child of that Node under `--permission`,
with read access to its folder and its bootstrap only, and an empty environment. It proves it
is confined before its code is imported, and the host now refuses it otherwise
(`E_PLUGIN_SANDBOX`). The network is still not confined, and the plugins screen says so. The
installers grow by 22.4 MiB on Windows, 37.4 MiB on macOS and 43.0 MiB on Linux.
