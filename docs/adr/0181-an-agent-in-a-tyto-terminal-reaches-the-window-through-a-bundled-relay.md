# 0181 — An agent in a Tyto terminal reaches the window through a bundled relay, not through `tyto`

Status: accepted · 2026-11-09 · TYTO-567 · builds on ADR 0164, ADR 0179 and ADR 0180 · keeps ADR
0164 decision 4

## Context

A terminal tab runs any program (ADR 0164), so `claude` or `codex` already run there and edit
files. They cannot see the window: ADR 0180 lets an agent reach a running window through
`tyto mcp --window`, but the terminal has no `tyto` on its `PATH`. That was Rafael's own choice in
ADR 0164 decision 4, which gives the shell main's environment and nothing of Tyto's. TYTO-567
(layer 3 of E24) asked to revisit it, or to settle that the window's endpoint replaces it.

Read on `origin/main` at fdc18fe5:

- **The package ships no runnable `tyto`.** The command panel runs the CLI inside main (ADR
  0159), and TYTO-335 (ship the command line with the installed app) is still To Do. ADR 0159
  measured a self-contained CLI at 4,154,013 bytes, before a rasterizer for it. So putting `tyto`
  on the terminal's `PATH` and naming its absolute path in an agent's configuration both need
  something new that runs.
- **The package already carries a Node** for plugins (ADR 0050), at `resources/node/`, and an
  unpacked folder beside the asar that Node can read (`app.asar.unpacked/out/guest/`).
- **The relay is small.** `tyto mcp --window` copies bytes between stdio and the window's endpoint
  after a one-line handshake (`relay.ts`, `window-endpoint.ts`: 386 lines with their comments).
- **The agent CLIs take their MCP servers on the command line.** `claude --mcp-config <file or
JSON>` and `codex -c mcp_servers.<name>.<key>=<TOML>`, read in their `--help` on this machine.
  Neither needs a file in the workspace. Claude Code has no environment variable that adds a
  server.
- **With several windows open, the relay picks by folder, then by recency** (ADR 0180 decision
  4). An agent started in one window's terminal may get another window.

On 2026-11-09 the coordinator put three options to Rafael. A: `tyto` on the terminal's `PATH`
(revisits decision 4, waits for TYTO-335). B: the agent's configuration names the absolute path
of a bundled `tyto` (keeps decision 4, still waits for TYTO-335). C: a relay alone, run on the
bundled Node. Rafael chose C ("C, só o relé").

## Decision

1. **ADR 0164 decision 4 stands: `tyto` stays off the terminal's `PATH`.** An agent gets a relay,
   not the command line. `tyto` on that `PATH` may come later with TYTO-335, under its own
   decision.

2. **The relay is built on its own and run on the bundled Node.** `apps/desktop/src/main/
agent-relay.ts` calls `relayToWindow` from `@tyto/command-line/relay`, a subpath export that
   carries the relay and nothing of the command tree. `vite.relay.config.ts` builds it into
   `out/relay/agent-relay.js` with every dependency inlined (178 KB, most of it `zod`), the way
   `vite.guest.config.ts` builds the plugin bootstrap. `electron-builder.yml` unpacks it, because
   the bundled Node is not Electron and cannot read inside an asar. The bundle imports only Node's
   own modules, which the desktop suite checks in the built file.

3. **A terminal Tyto starts carries `TYTO_WINDOW`, the window's process id**, beside
   `TERM_PROGRAM=Tyto`. The relay prefers that window over ADR 0180 decision 4's rule, and says
   so on stderr ("relaying to the window that started this terminal"). When that window is gone,
   because the terminal outlived it or the variable was copied elsewhere, the relay says so and
   falls back to the folder rule rather than failing. `tyto mcp --window` reads the same variable,
   so a `tyto` run from such a terminal behaves the same.

4. **Open an Agent Here** (`terminal.openAgent`, in the Tools menu and the command bar) starts the
   program `agentCommand` names (default `claude`) in a new terminal tab in the workspace folder,
   with `agentArgs` after the arguments that connect it to the window:
   - `claude`: `--mcp-config <TYTO_HOME>/agents/window-<pid>.json`, a file main writes (mode 0600) just before the start and removes when the app quits. It names one stdio server,
     `tyto`: the bundled Node, the relay, and `TYTO_WINDOW` and `TYTO_HOME` in its `env`.
   - `codex`: three `-c` overrides for `mcp_servers.tyto` (`command`, `args`, `env`), as TOML
     literal strings.
   - Any other program starts with its own arguments only. `TYTO_WINDOW` is in its environment,
     so it can register the relay itself.

   **The renderer never names the program.** `terminal:open` gains `agent: true`, a yes or no, as
   ADR 0164 decision 3 requires. `agentCommand` and `agentArgs` are read from `settings.json`
   only, as `terminalShell` is, because a folder that chose the program to run would be a source
   shipping code (ADR 0111). **Tyto installs no agent.** A program that is not on `PATH` is a
   line in the Terminal tab ("was not found on PATH … Tyto installs no agent"), and nothing
   starts. With `agentsListen` off the command says so too, rather than starting an agent that
   cannot connect.

5. **A file in `TYTO_HOME`, not the JSON on the command line, and nothing with a double quote on
   it.** On Windows an agent installed by npm is a `.cmd` file, so `CreateProcess` runs it through
   `cmd.exe`, which reads the command line again. `cmd.exe` gives a double quote a meaning of its
   own, and JSON is made of them. node-pty takes the arguments as an array and quotes only those
   with spaces, so a path with spaces (`C:\Users\Ana Maria\…`) arrives as one argument. A value
   holding a quote of either kind or a line break is refused with a message rather than escaped.
   The file names no secret: the token stays in the window's record (ADR 0180 decision 3).
   **Nothing is written into the workspace.**

6. **A restricted workspace refuses the agent as it refuses the shell** (ADR 0164 decision 5), in
   main, before the program is even looked for. An agent is a program started in the folder, and
   the folder's files reach it the same way. With no folder open the agent starts in the home
   folder and gets the window's reads only (ADR 0180 decision 7).

7. **Registering the relay by hand.** A person who types `claude` in any terminal can register the
   relay once, with `claude mcp add`, naming the bundled Node and the relay by their absolute
   paths. Tyto never writes the agent's own configuration. Those paths survive an update only
   where the install folder does not move. By electron-builder's defaults (read, not measured),
   the per-user NSIS install is `%LOCALAPPDATA%\Programs\Tyto` and the macOS app is where the
   person put `Tyto.app`; both keep their place across updates. The portable `.exe` and the
   AppImage unpack into a new temporary folder at every start, so a registered path is stale by
   the next launch. A "copy the command" action would copy a line that breaks just as soon, so
   none is offered. There, Open an Agent Here is the way in.

## Consequences

- From a Tyto terminal, `claude` or `codex` started by Open an Agent Here reads the brief in
  front, checks it, and proposes edits that the person accepts in the editor (ADR 0180), with
  nothing installed and nothing written into the workspace.
- The package grows by the relay bundle, about 178 KB unpacked. The bundled Node now has a second
  file to run, and the relay runs with the person's permissions, as the agent that starts it does.
- An agent that registered the relay by hand, outside Tyto's terminals, still picks a window by
  ADR 0180 decision 4.
- `test:package` gains a line for the relay on the bundled Node, on all four legs of
  `desktop.yml`.

## Left open

| What                                                                  | Why it matters                                                                  | Status       | Card     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------ | -------- |
| `tyto` on the terminal's `PATH`                                       | The person could run `tyto` by hand in Tyto's terminal                          | Not decided  | TYTO-335 |
| A path that survives updates for the portable `.exe` and the AppImage | `claude mcp add` by hand goes stale at every start there                        | Not measured | —        |
| The real `claude` and `codex` against the window, end to end          | The suites run a stand-in that does what their hosts do with the same arguments | Not measured | —        |
