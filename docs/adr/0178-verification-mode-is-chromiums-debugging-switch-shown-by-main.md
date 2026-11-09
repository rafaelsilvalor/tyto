# 0178 — Verification mode is Chromium's debugging switch, shown by main

Status: accepted · 2026-11-09 · TYTO-651 · builds on ADR 0067 and ADR 0103

## Context

An agent helping the maintainer could only see the running app through screenshots he took and
sent, one round trip at a time (TYTO-651). The packaged suite already drives the app over the
Chrome DevTools Protocol: Chromium's `--remote-debugging-port` is a switch no Electron fuse gates,
and it reaches the window and its preload bridge but not main (ADR 0067, ADR 0103,
`e2e/cdp-app.ts`). The questions were how a person's own Tyto opens that port only when asked,
whether it stays on the machine, and how the person knows it is open.

Measured on 2026-11-09 with Electron 44.4.5 on Windows 11, a minimal app, each arm its own
`--user-data-dir`, the listening sockets read with `netstat -ano` for the app's own process ids:

```
=== off: (no switch)
DevToolsActivePort: none
LISTENING sockets of the app's processes (4 pids):
fetch http://127.0.0.1:9333/json/version -> ECONNREFUSED
=== loopback: --remote-debugging-port=9333
DevToolsActivePort: 9333
LISTENING sockets of the app's processes (4 pids):
  TCP    127.0.0.1:9333         0.0.0.0:0              LISTENING       20588
fetch http://127.0.0.1:9333/json/version -> HTTP 200
=== anyaddr: --remote-debugging-port=9333 --remote-debugging-address=0.0.0.0
DevToolsActivePort: 9333
LISTENING sockets of the app's processes (4 pids):
  TCP    127.0.0.1:9333         0.0.0.0:0              LISTENING       27292
fetch http://127.0.0.1:9333/json/version -> HTTP 200
```

The last arm was repeated reading IPv4 and IPv6 together: one socket, `127.0.0.1:9333`.
Chromium honours `--remote-debugging-address` in headless mode only.

## Decision

1. **The switch is Chromium's `--remote-debugging-port=<port>`, on the command line of whoever
   starts the app.** The launcher passes it when asked (`docs/agents.md` gives the line). Tyto's
   own code never opens the port and adds no switch of its own. Off is the default because
   nothing passes it.
2. **No environment variable.** One was considered (main calling `appendSwitch` when it is set)
   and turned down: plugins and the integrated terminal inherit the app's environment, so a Tyto
   started from that terminal, or by a plugin's process, would open a port nobody asked for. An
   argument reaches one process.
3. **Main detects it and the window shows it.** `src/main/verification-mode.ts` reads the switch
   off `app.commandLine`, and for port `0` the number Chromium wrote into `DevToolsActivePort`;
   `verification:status` answers the window, which draws "Verification mode · port N" (or "· on"
   when the number is not known) first on the status bar, outside the `statusBarItems` list, so
   no setting hides it. Main also writes one warning line into the log at start.
4. **Loopback only, as measured.** The port listens on `127.0.0.1` even when
   `--remote-debugging-address=0.0.0.0` is passed. No code guards this; if a later Electron
   changes it, the measurement above is what to repeat.
5. **The probe reads, and runs only what a click runs.** `apps/desktop/scripts/verify.ts`
   connects with Playwright's `connectOverCDP` and prints plain text and PNG paths:
   `screenshot`, `text`, `tabs`, `plugins` (credentials as set / not set, from `plugins:list`;
   no `credentials:*` channel is called, so no value crosses), and `recipe [--fresh]`, which runs
   `recipe.run` or `recipe.runFresh` through the command bar, as the person's Run, and prints
   each cell's status and plan lines. `recipe` is never a default and prints the command before
   running it. It fetches the recipe's sources, and a recipe whose header says `apply auto`
   (ADR 0170) applies its plan on that Run, as it does on the person's.

## Consequences

- **While the mode is on, any program on the machine can read and drive the window**, through
  the same port the probe uses: read what it shows, run any command, call any bridge channel the
  page can call, including `credentials:set`. It cannot run code in main (ADR 0067). The badge's
  tooltip says so, and the mode ends when Tyto is restarted without the switch.
- This was already true of any Tyto someone started with the switch, packaged or not (ADR 0067);
  what changes is that the window now says so.
- The probe reaches the window, not main: anything only main knows is not visible to it.
  TYTO-565 (`tyto mcp`) and TYTO-566 are the structured path.
- With `--remote-debugging-port=0` the badge has its number only once Chromium has written
  `DevToolsActivePort`; the window asks once at load, when the port is already open.
