---
'@tyto/plugin-api': minor
---

TYTO-445: `@tyto/plugin-api/testing` runs a plugin the way the app runs it, inside a test. `testPlugin({ manifest, load })` checks the manifest's text as install does, activates the built entry over the real isolation protocol and `tryActivate`, resolves the settings it is handed, and answers either the diagnostics the app would refuse it with or a harness that runs recipes over its verbs with a fixed clock, its project section and in-memory secrets. It reads no folder and does not exercise the sandbox (ADR 0150).
