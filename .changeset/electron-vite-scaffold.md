---
'@tyto/desktop': minor
---

TYTO-40 — the desktop app opens a window

`apps/desktop` was a placeholder with one `export {}` in it. It is now an electron-vite app
that starts: main, a sandboxed preload and a renderer, built separately and linted as the
two runtimes they are.

What is in it:

- **The window, under the three flags ADR 0001 names**: `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`. The end-to-end suite asserts all three by name,
  read back off the running window, as well as asserting that `window.require` is undefined —
  both, because the consequence alone does not pin them.
- **One IPC contract, in `shared/ipc.ts`.** A table of channels with a Zod schema per
  direction. Main registers handlers by walking it, the preload builds `window.tyto` from it,
  and both sides validate — main because it may not trust another process, the preload
  because it is the only side that can refuse before the message is sent.
- **`safeStorage` for credentials**, with the encryption injected rather than imported, so
  the wrapper is testable without a keychain. A locked or absent keyring stops the write
  instead of degrading it to plaintext.
- **i18n with `pt-BR` first and `en` as the fallback**, as a `Catalogue` type: a locale
  missing a key does not compile. No element in the renderer carries a literal — every string
  is painted from a `data-i18n` key, which is what makes "switching locale changes every
  visible string" a property a test can check.
- **A composition root that registers the built-in template pack through the `PluginHost`**,
  and reports what the host actually holds through `app:info`, so a pack that failed to
  activate shows as an empty list rather than as nothing.

`pnpm --filter @tyto/desktop test:desktop` runs the Electron suite. It is deliberately outside
`pnpm check`: it downloads a ~246 MB binary on first use, the same reason `packages/raster`
keeps its visual suite out.

Two config changes reach the repo root. `electron` joins `allowBuilds` in
`pnpm-workspace.yaml` — pnpm blocks it by name and fails the install otherwise, though the
package ships no install script and the download still happens on first use. And
`eslint.config.js` now splits `apps/desktop` across the runtime boundaries instead of calling
the whole app Node.
