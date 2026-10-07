---
'@tyto/desktop': patch
---

The packaged app can no longer be run as a plain Node: Electron's RunAsNode and `NODE_OPTIONS`
fuses are switched off (TYTO-193, ADR 0067). Installed plugins now start their process with
`spawn` instead of `fork`, which Electron refuses once that fuse is off; they still run on the
bundled Node, under the same permissions.
