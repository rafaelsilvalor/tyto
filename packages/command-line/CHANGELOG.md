# @tyto/command-line

## 0.7.0

### Minor Changes

- 68a241a: TYTO-671, ADR 0193: `call`'s adapter and the workspace's allow-list. `.tyto/project.json` learns
  `recipes.call.hosts`, read from trusted sheets only, a later sheet's list replacing an earlier
  one whole, as `ResolvedProject.callHosts`. `@tyto/io` adds `recipeCallPorts`: the platform's
  `fetch` with no redirect followed, an abort at the deadline, the host re-checked with `URL`
  against the list, the credential read and set as the header on the host's side, the response's
  body never read, and every failure said with the credential replaced by `[credential]`. The
  recipe runner takes a `calls` option and binds it to each run's folder. `tyto mcp`'s
  `run_recipe` plans `call` against the list and `TYTO_RECIPE_CREDENTIAL_<NAME>` and sends nothing.
- 091d64f: `tyto recipe run <recipe>` runs a recipe from the terminal through the shared runner, in the
  workspace that holds it (TYTO-673). Without `--apply` it plans only, commits no state and
  prints every cell, row count and operation; `--json` prints the whole answer as one document,
  every row and operation with its payload, nothing cut. `--apply` applies every plan once and
  commits the recipe's state, in a trusted folder only, and is how the CLI sends `call`'s
  requests. `--param name=value` gives a `param` line a value, and `--section` works as on
  `tyto render`. The runner in `@tyto/io` takes the values for a run's `param` lines.

### Patch Changes

- Updated dependencies [f1c7f59]
- Updated dependencies [9aa8b41]
- Updated dependencies [68a241a]
- Updated dependencies [e7c1db1]
- Updated dependencies [fe22e84]
- Updated dependencies [091d64f]
- Updated dependencies [0ed9eba]
- Updated dependencies [fb2a524]
  - @tyto/io@5.7.0
  - @tyto/recipe@0.5.0
  - @tyto/core@0.44.0
  - @tyto/plugin-api@0.20.0
  - @tyto/export-html@0.7.20
  - @tyto/export-svg@2.0.20
  - @tyto/fonts@0.5.0
  - @tyto/google-fonts@0.1.19
  - @tyto/pipeline@0.12.16
  - @tyto/raster@0.2.4
  - @tyto/template-lang@0.8.18
  - @tyto/templates@1.2.14

## 0.6.0

### Minor Changes

- 9bc6f97: On Windows the window serves agents on loopback TCP (`127.0.0.1`) instead of a named pipe, which
  accepted clients through the SMB redirector, and keeps `TYTO_HOME/windows` to its owner and
  SYSTEM (ADR 0189). The relay connects to no `tcp://` endpoint off loopback. `endpointFor` is
  replaced by `listenTargetFor`, `loopbackEndpoint`, `connectTargetOf` and `connectToEndpoint`.
- 4cae56d: A plugin can have the host send a credential in a header, `host.fetch(url, { credentialHeaders })`,
  without ever holding it, only to a host a `net:` permission of its own names (`E_CREDENTIAL_HOST`
  otherwise). `host.storage` keeps small durable JSON records under the plugin's data folder,
  kept by updates and a wiped cache and removed with the plugin (`E_PLUGIN_STORAGE`). ADR 0191; the
  isolation protocol is 24.
- cf973ad: `tyto mcp` offers `run_recipe` in a trusted workspace (ADR 0185, note of 2026-11-10): a run answers
  each cell's table and plan and changes nothing, `apply auto` included; an apply names the cell and
  the plan id that run answered. No answer carries a plan's payload or a plugin's section.
- 94c593c: The install prompt says in words what `window:tools` lets a plugin do: use Tyto's tools in the
  open window, reading what is open there and proposing edits the person accepts or rejects, while
  `agentsListen` is on (ADR 0190).

### Patch Changes

- Updated dependencies [4cae56d]
- Updated dependencies [58baf48]
- Updated dependencies [94c593c]
  - @tyto/plugin-api@0.19.0
  - @tyto/io@5.6.0
  - @tyto/core@0.43.1
  - @tyto/recipe@0.4.0
  - @tyto/export-html@0.7.19
  - @tyto/export-svg@2.0.19
  - @tyto/google-fonts@0.1.18
  - @tyto/pipeline@0.12.15
  - @tyto/fonts@0.5.0
  - @tyto/raster@0.2.4
  - @tyto/template-lang@0.8.17
  - @tyto/templates@1.2.13

## 0.5.0

### Minor Changes

- 313f28f: `tyto mcp` serves what each template's folder says about writing a brief for it (ADR 0186): its
  `guide.md` and its `examples/*.brief` as resources, capped and cut with a line that says so, and
  the `model_brief` prompt, which puts generic steps, the template's slots, skeleton, guide and
  examples in front of the copy. A restricted folder's own templates serve neither.
- a3a90f6: `tyto mcp` offers three tools that write, to a trusted workspace only (ADR 0185): `write_brief`
  creates or replaces a `.brief` (a dry run shows the diff and the hash a replacement must name;
  a brief in a folder a live window has open is not replaced), `new_delivery` makes a delivery as
  `tyto delivery new` does, and `export` renders into a preset's folder, the delivery's or the
  workspace's `output`, never a folder the agent names.

### Patch Changes

- Updated dependencies [846274c]
  - @tyto/plugin-api@0.18.0
  - @tyto/io@5.5.0
  - @tyto/export-html@0.7.18
  - @tyto/export-svg@2.0.18
  - @tyto/google-fonts@0.1.17
  - @tyto/pipeline@0.12.14
  - @tyto/raster@0.2.4
  - @tyto/templates@1.2.12

## 0.4.0

### Minor Changes

- 7345ac7: TYTO-657, ADR 0184: a plugin may ship its own program and open a terminal for it. A manifest's
  new `programs` maps a declared `process:<name>` to a script inside the plugin's folder, which
  the host runs on its bundled Node instead of looking the name up on `PATH`; the port's
  `startProcess` receives that script as a fifth argument. `host.terminal.open(name, args)` asks
  the host for a terminal tab running a declared program, one open at a time
  (`PLUGIN_TERMINAL_LIMIT`), behind `checkedTerminal` and the optional port
  `HostCapabilities.openTerminal`. New codes `E_PROCESS_SCRIPT_MISSING`, `E_TERMINAL_UNAVAILABLE`
  and `E_TERMINAL_LIMIT`. `RPC_PROTOCOL_VERSION` is 22. The install prompt says when a program is
  the plugin's own code, what still holds it and what does not, and that the plugin may open a
  terminal tab running its programs.

### Patch Changes

- f35c2d1: TYTO-656: `tyto mcp --window` tries the next window when nobody listens at a record's endpoint,
  instead of failing. The desktop's packaged suite connects to its own window's record by pid, and
  the RunAsNode probe gets a `TYTO_HOME` of its own so it leaves no orphan record behind.
- Updated dependencies [7345ac7]
  - @tyto/plugin-api@0.17.0
  - @tyto/core@0.43.0
  - @tyto/export-html@0.7.17
  - @tyto/export-svg@2.0.17
  - @tyto/google-fonts@0.1.16
  - @tyto/io@5.4.1
  - @tyto/pipeline@0.12.13
  - @tyto/fonts@0.5.0
  - @tyto/raster@0.2.4
  - @tyto/template-lang@0.8.16
  - @tyto/templates@1.2.11

## 0.3.0

### Minor Changes

- edc97c6: TYTO-373: `installPlugin` and `changePluginState` install, remove, disable and enable a plugin
  as steps that answer a `Result`, for the window to call as `tyto plugin` does. `tyto plugin
install` also takes a local `.tgz` or `.tar.gz` archive, unpacked with `tar` and no npm, and
  its permission prompt says what `workspace:read` and `workspace:write` reach.
- bf255a4: TYTO-565: `tyto mcp [folder]` serves a folder's templates and briefs to an AI agent over the
  Model Context Protocol on stdio, with four read tools: `list_templates`, `describe_template`,
  `check_brief` and `render_preview` (a PNG at most 1,024 px on its longest side). A restricted
  folder is offered no tool that writes (ADR 0179). A plugin's process now prints onto stderr, so
  its output no longer lands in `tyto render --json`'s document. The window refuses `tyto mcp`.
- fdc18fe: TYTO-566: an agent's edit arrives as a proposal (ADR 0180 decision 5). `propose_edit` shows an
  edit of the document in front, struck-through and inserted text under an Accept / Reject bar;
  accepted, it is one undo step and saves nothing, and typing in it makes it stale.
  `proposal_status` tells the agent how it ended. `@tyto/editor` gains the `proposals` extension.
- 422b6bc: TYTO-566: `tyto mcp --window [folder]` relays an agent's stdio to a running window's local
  endpoint, after reading its record in `TYTO_HOME/windows/` and sending its token (ADR 0180).
  The window does not listen yet, so the option is hidden and answers that no window is open.
  The desktop only gains a test: its command panel refuses `mcp --window` as it refuses `mcp`.
- f3196f6: TYTO-566: the window listens for agents (ADR 0180). It writes its record into
  `TYTO_HOME/windows/`, checks each connection's token and serves the same tools as `tyto mcp`
  through the new `serveAgent`. The status bar shows the agents connected, and its click cuts
  them. `tyto mcp --window` is now offered. The MCP SDK is bundled into a lazy chunk of main.
- 639317d: TYTO-566: the window's tools for agents (ADR 0180). Served by a window, `tyto mcp` adds
  `brief_in_front` and `selection` in any folder, and `open_file` and `show_format` in a trusted
  one, asked first in a box unless `agentsWindowActions` is `allow`. `agentsListen` turns the
  window's endpoint off and on, live. `serveAgent` takes the window as a `WindowPort`.
- 661a573: An agent started in Tyto's terminal reaches the open window (TYTO-567, ADR 0181). Terminal: Open
  an Agent Here starts the program `agentCommand` names (default `claude`, with `agentArgs` after)
  in a new terminal tab, told through `--mcp-config` (or Codex's `-c`) to start the window relay on
  the bundled Node; Tyto installs no agent, and a missing program is a line in the tab. Every
  terminal carries `TYTO_WINDOW`, which `tyto mcp --window` and the relay prefer over the folder
  rule, falling back to it when that window is gone. `@tyto/command-line` gains the
  `@tyto/command-line/relay` subpath export.
- c0875cc: A plugin may declare `process:<name>` and start that one program through the host (TYTO-568,
  ADR 0182). The name is bare: no path, wildcard or extension. `host.process.start(name, args)`
  answers a long-lived handle with `write`, `end`, `kill`, `onStdout`, `onStderr` and `exited`,
  behind the optional `HostCapabilities.startProcess` port and `checkedProcesses`: an undeclared
  name is `E_PERMISSION`, a host without the port (the CLI) is `E_PROCESS_UNAVAILABLE`, a third
  running program is `E_PROCESS_LIMIT`, and a write after the end is `E_PROCESS_EXITED`. A
  plugin's programs end when it stops. `RPC_PROTOCOL_VERSION` is 19. `@tyto/core` gains six
  `E_PROCESS_*` codes, and the install prompt names each program a plugin may start. No host
  starts a program yet.
- 64a7b70: A plugin that declares a `process:<name>` can ask for the window's MCP server and hand it to
  the agent it starts (TYTO-569, ADR 0183). `host.window.agentServer()` answers
  `{ name: 'tyto', command, args, env }`, the shape ACP's `session/new` takes in `mcpServers`:
  the bundled Node, the relay Open an Agent Here names, and `TYTO_WINDOW` and `TYTO_HOME` only,
  which the host's check enforces with a strict schema. A plugin with no program is
  `E_PERMISSION`, the CLI is `E_WINDOW_UNAVAILABLE`, and the desktop refuses `agentsListen` off
  (`E_WINDOW_AGENTS_OFF`) and a restricted folder (`E_WINDOW_RESTRICTED`), read at each call.
  `RPC_PROTOCOL_VERSION` is 20. The install prompt's `process:` paragraph now says that the
  program can also reach the Tyto window as an agent, with its edits arriving as proposals.

### Patch Changes

- cd096ab: A panel contribution may register `call(request)` (TYTO-372, ADR 0173): its page asks the
  plugin's own process to do work, `{ method, params? }` in and JSON out, with the method matching
  `^[a-z][\w.-]{0,99}$`, both sides at most 1 MiB of JSON and an isolated plugin's call under the
  30 s deadline of every call. `@tyto/plugin-api` gains `callPanel` and `panelCallerOf`, the host's
  half, which find the panel by the caller's id and refuse a request that names a plugin or a
  panel; `RPC_PROTOCOL_VERSION` is 17. `@tyto/core` gains the diagnostic code `E_PANEL_CALL`. The
  desktop does not offer `call` to a page yet. `@tyto/command-line` changes only a test, which
  now reads the protocol from `RPC_PROTOCOL_VERSION` instead of a literal.
- ae4a916: TYTO-373: the plugins screen installs a plugin from a folder or a `.tgz` archive, after a native
  box that shows the same permissions `tyto plugin install` prints, and removes, disables and
  enables an installed one; Settings opens `settings.json` at the plugin's keys. Changes apply the
  next time Tyto starts, and each row says so. `tyto plugin install --help` names the local archive,
  and a test proves a hostile archive writes nothing outside the folder it is unpacked into.
- d836583: TYTO-652: `tyto mcp` draws an image a brief cites only when its real path is inside the folder,
  its workspace or the workspace's asset folders, so a link inside the folder no longer reads a
  file outside it; an escape answers as a missing file. `render_preview` fetches from a plugin or
  Google Fonts only in a trusted workspace (ADR 0179 amendment).
- Updated dependencies [cd096ab]
- Updated dependencies [ed7a364]
- Updated dependencies [4a91cef]
- Updated dependencies [4db076c]
- Updated dependencies [092d29e]
- Updated dependencies [c0875cc]
- Updated dependencies [046a5b9]
- Updated dependencies [64a7b70]
  - @tyto/core@0.42.0
  - @tyto/plugin-api@0.16.0
  - @tyto/pipeline@0.12.12
  - @tyto/io@5.4.0
  - @tyto/export-html@0.7.16
  - @tyto/export-svg@2.0.16
  - @tyto/fonts@0.5.0
  - @tyto/google-fonts@0.1.15
  - @tyto/raster@0.2.4
  - @tyto/template-lang@0.8.15
  - @tyto/templates@1.2.10

## 0.2.8

### Patch Changes

- 97c8598: An action or a sink may register `apply` (TYTO-378, ADR 0170). `apply(request)` is handed one
  batch of at most 100 operations of the plan a person was shown (`APPLY_BATCH`), with the
  step's arguments, the plan's target and the plugin's section, and answers one
  `{ status, reason? }` per operation in the same order. A planned operation may carry the
  plugin's own `payload`, which now crosses the isolation boundary. `recipeRegistriesOf` gives
  such a verb `apply(plan)`: before any call it looks the verb up again and checks the kept plan
  against the writes the verb declares now, refusing the whole Apply with `E_RECIPE_APPLY`; it
  maps each answer onto the shown plan's row and stamps `appliedAt` from its own clock (the new
  `now` option); a batch with no readable answer is `failed` with `APPLY_NO_ANSWER` and every
  later batch `skipped`. **Breaking for plugins: the isolation protocol is 16**, so a plugin
  process on 15 is refused at `hello`; a plugin that registers `apply` writes
  `"engine": ">=0.15"`. The example recipe plugin's `example.mark` applies its plan into its
  private cache. `@tyto/command-line` changes only a test.
- Updated dependencies [97c8598]
- Updated dependencies [6b193ff]
- Updated dependencies [fb529a1]
  - @tyto/plugin-api@0.15.0
  - @tyto/core@0.41.0
  - @tyto/export-html@0.7.15
  - @tyto/export-svg@2.0.15
  - @tyto/google-fonts@0.1.14
  - @tyto/io@5.3.1
  - @tyto/pipeline@0.12.11
  - @tyto/fonts@0.5.0
  - @tyto/raster@0.2.4
  - @tyto/template-lang@0.8.14
  - @tyto/templates@1.2.9

## 0.2.7

### Patch Changes

- 8d081ec: A plugin file now says when a pack it fetched holds templates none of its entries names:
  `W_PLUGIN_FILE_TEMPLATE_UNNAMED`, once per pack at the first entry that fetched it, names them
  and says to add an entry for each with the same git and ref. A brief naming one of them still
  gets `E_UNKNOWN_TEMPLATE`, now with a hint that the pack holds it. `tyto render` and the
  desktop app's problems panel show both. The registry keeps what a root with `only` skipped, in
  `TemplateRegistry.unoffered` (TYTO-615).
- Updated dependencies [6f4c86e]
- Updated dependencies [f658466]
- Updated dependencies [4a7c29d]
- Updated dependencies [8d081ec]
  - @tyto/core@0.40.0
  - @tyto/io@5.3.0
  - @tyto/export-html@0.7.14
  - @tyto/export-svg@2.0.14
  - @tyto/fonts@0.5.0
  - @tyto/google-fonts@0.1.13
  - @tyto/pipeline@0.12.10
  - @tyto/plugin-api@0.14.3
  - @tyto/raster@0.2.4
  - @tyto/template-lang@0.8.13
  - @tyto/templates@1.2.8

## 0.2.6

### Patch Changes

- Updated dependencies [d2ca2f1]
  - @tyto/core@0.39.0
  - @tyto/export-html@0.7.13
  - @tyto/export-svg@2.0.13
  - @tyto/fonts@0.5.0
  - @tyto/google-fonts@0.1.12
  - @tyto/io@5.2.4
  - @tyto/pipeline@0.12.9
  - @tyto/plugin-api@0.14.2
  - @tyto/raster@0.2.4
  - @tyto/template-lang@0.8.12
  - @tyto/templates@1.2.7

## 0.2.5

### Patch Changes

- Updated dependencies [b5d2c00]
  - @tyto/core@0.38.0
  - @tyto/export-html@0.7.12
  - @tyto/export-svg@2.0.12
  - @tyto/fonts@0.5.0
  - @tyto/google-fonts@0.1.11
  - @tyto/io@5.2.3
  - @tyto/pipeline@0.12.8
  - @tyto/plugin-api@0.14.1
  - @tyto/raster@0.2.4
  - @tyto/template-lang@0.8.11
  - @tyto/templates@1.2.6

## 0.2.4

### Patch Changes

- Updated dependencies [6d363a3]
- Updated dependencies [7c650a4]
- Updated dependencies [d1cd8ba]
  - @tyto/fonts@0.5.0
  - @tyto/core@0.37.0
  - @tyto/raster@0.2.4
  - @tyto/plugin-api@0.14.0
  - @tyto/export-html@0.7.11
  - @tyto/export-svg@2.0.11
  - @tyto/google-fonts@0.1.10
  - @tyto/io@5.2.2
  - @tyto/pipeline@0.12.7
  - @tyto/template-lang@0.8.10
  - @tyto/templates@1.2.5

## 0.2.3

### Patch Changes

- @tyto/templates@1.2.4

## 0.2.2

### Patch Changes

- @tyto/templates@1.2.3

## 0.2.1

### Patch Changes

- Updated dependencies [e94aa55]
  - @tyto/core@0.36.1
  - @tyto/export-html@0.7.10
  - @tyto/export-svg@2.0.10
  - @tyto/fonts@0.4.1
  - @tyto/google-fonts@0.1.9
  - @tyto/io@5.2.1
  - @tyto/pipeline@0.12.6
  - @tyto/plugin-api@0.13.1
  - @tyto/raster@0.2.3
  - @tyto/template-lang@0.8.9
  - @tyto/templates@1.2.2

## 0.2.0

### Minor Changes

- 8dd4503: The command tree says what each argument and option takes, for the window's completion (TYTO-496): `commandTree` gives each option its long and short flag, whether it takes a value, and, where `program.ts` says so beside the definition, the kind of value (a brief, a file, a folder, a template, format ids, output types with the built-in four as choices, or a plugin). `valuesOf` refuses a name the command does not declare, so a renamed option fails when the program is built. Nothing a command accepts or refuses changes.
- 9bcb68b: `tyto gallery list | install | update` reads the curated index when neither `--index` nor `TYTO_GALLERY_INDEX` names one (TYTO-506, ADR 0162): `DEFAULT_GALLERY_INDEX`, a plain git location exported by `@tyto/plugin-api`. `--index` wins over the variable, and the variable over the default.

### Patch Changes

- 213f553: TYTO-504: `tyto gallery list | install | update` print what `@tyto/io`'s gallery operations answer; what they write and say is unchanged.
- 9021b50: Rename shadowing local bindings without changing behavior and enforce the no-shadow lint rule.
- Updated dependencies [213f553]
- Updated dependencies [9021b50]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [bd56ec5]
- Updated dependencies [9bcb68b]
- Updated dependencies [05c9f83]
  - @tyto/io@5.2.0
  - @tyto/core@0.36.0
  - @tyto/pipeline@0.12.5
  - @tyto/plugin-api@0.13.0
  - @tyto/template-lang@0.8.8
  - @tyto/export-html@0.7.9
  - @tyto/export-svg@2.0.9
  - @tyto/raster@0.2.3
  - @tyto/fonts@0.4.1
  - @tyto/google-fonts@0.1.8
  - @tyto/templates@1.2.1

## 0.1.0

### Minor Changes

- cd5e075: New package: the `tyto` command tree, moved out of `apps/cli` so the desktop can run the same commands in its main process (ADR 0159). `CliEnvironment` gains `launch`, the port that starts an installed plugin's process; the package chooses no launcher and no rasterizer on an app's behalf.
- 787c4ce: `environment.diagnostics` receives every diagnostic a run prints, already placed at the file, line and column the printed text names (ADR 0159 decision 7). The sink belongs to the run, so two runs at once each receive only their own diagnostics. What a command prints does not change: across the package's suite, the 113 printed outputs were byte-identical before and after.
- a5a896a: `run(argv, environment, signal)` stops a run part of the way through: `render` between frames, `watch` between sweeps (ADR 0159 decision 6). `environment.refuse` is asked before every command with its path, arguments and parsed options; a sentence refuses the command with exit 1. `environment.shellRefusal` makes a run fail at any step that would start a shell, which today is `npm` on Windows, whichever command reached it. `commandTree` describes the command tree as data. A terminal sets none of these, so `tyto` behaves as before.
- 4168183: `tyto gallery list | install <id> | update <id>` (TYTO-503, ADR 0162). The index is `--index <git>` or `TYTO_GALLERY_INDEX`. `list` shows each entry as installed, update available or not installed against the machine's plugin files and lock; `install` writes it into `~/.tyto/plugin-files` pinned to its latest tag and syncs; `update` moves its ref where it lives and syncs, refusing a ref changed by hand since the gallery wrote it unless `--force`.

### Patch Changes

- Updated dependencies [fc3bee5]
- Updated dependencies [fc3bee5]
- Updated dependencies [04233fc]
- Updated dependencies [6881557]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
- Updated dependencies [4168183]
- Updated dependencies [4168183]
  - @tyto/templates@1.2.0
  - @tyto/core@0.35.0
  - @tyto/fonts@0.4.1
  - @tyto/plugin-api@0.12.0
  - @tyto/template-lang@0.8.7
  - @tyto/io@5.1.0
  - @tyto/pipeline@0.12.4
  - @tyto/export-html@0.7.8
  - @tyto/export-svg@2.0.8
  - @tyto/google-fonts@0.1.7
  - @tyto/raster@0.2.2
