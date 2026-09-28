---
'@tyto/cli': minor
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/io': minor
'@tyto/desktop': patch
---

Run each installed plugin in the CLI confined to its own folder by Node's permission model
(TYTO-186, ADR 0049).

- **CLI**: a plugin's process is a child process started with `--permission` and read access to
  its installed folder and its bootstrap only, both as real paths. It cannot read other files,
  write, start a process or a worker, or load an addon, and its environment is empty. The
  bootstrap (`dist/guest/plugin-guest.js`) inlines everything it imports. Before the plugin's
  code is imported, the process tries to read a file outside its grant. A plugin whose process
  could read it, or did not say, is refused with `E_PLUGIN_SANDBOX`, which names the runtime.
  The network stays advisory on Node 22 and 24: `net:` filters `host.fetch` only. The install
  prompt says so.
- **`@tyto/plugin-api`**: `RPC_PROTOCOL_VERSION` is 2, and `hello` carries a `sandbox` report.
  `runGuest` takes that report, `connectIsolatedPlugin` and `startInstalledPlugins` take
  `requireSandbox`, `PluginProcessRequest` gains `directory`, and `PluginStore` gains
  `linksLeaving`, which every load asks before a plugin starts.
- **`@tyto/core`**: `E_PLUGIN_SANDBOX` is new. `E_PLUGIN_LINK` is also reported at load, and its
  message no longer names install.
- **`@tyto/io`**: `fsPluginStore` implements `linksLeaving`.
- **Desktop**: unchanged in behaviour. It does not require the sandbox yet, because a
  `utilityProcess` accepts `--permission` and does not enforce it. The bundled Node that will
  confine it comes in the second TYTO-186 pull request.
