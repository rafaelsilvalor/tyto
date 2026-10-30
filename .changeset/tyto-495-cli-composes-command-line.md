---
'@tyto/cli': patch
---

The CLI now composes `@tyto/command-line`: its own code is the terminal's environment (stdout and stderr, a `[y/N]` prompt, `fork` for a plugin's process, Playwright for a raster). Every command, option, output and exit code is unchanged.
