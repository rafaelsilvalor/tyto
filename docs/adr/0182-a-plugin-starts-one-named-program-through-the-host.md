# 0182 — A plugin starts one named program, through the host

Status: accepted · 2026-11-09 · TYTO-568 · extends ADR 0042 · builds on ADR 0049, ADR 0111,
ADR 0164 and ADR 0181

## Context

The agent panel of TYTO-569 talks to an agent CLI over the Agent Client Protocol: JSON-RPC on the
program's stdin and stdout, for as long as the conversation lasts. The official CLIs log in
themselves, so Tyto never holds the person's subscription token. Before this ADR a plugin could
reach the network and keep its declared secrets (ADR 0042, ADR 0134), but it could not start
another program. Node's permission model keeps the plugin's own process from starting anything
(ADR 0049), and the install prompt says so.

Read on `origin/main` at 661a5735:

- **Every capability is decided in one place**, on the host's side: `checkedCapabilities`, in
  front of an optional port per capability on `HostCapabilities`. A host without a port answers a
  code that names it (`E_SIGNIN_UNAVAILABLE`, `E_CREDENTIAL_READ_ONLY`).
- **The isolation protocol already pushes**: the host sends `event` and `configure` messages
  on its own. Every request of the guest is answered once, with a 30 s deadline per call.
- **An update that asks for more is refused until a person says yes.** The loader refuses a
  plugin whose manifest declares a permission `plugins.json` never recorded
  (`E_PLUGIN_PERMISSIONS_CHANGED`). The plugin-files sync asks again for a fetched plugin whose
  permissions grew. `tyto plugin install`, and the window's install box, ask every time.
- **ADR 0164 and ADR 0181 already start programs the person chose**, in main, through
  node-pty: a shell, and the agent `agentCommand` names. Both are refused in a restricted
  workspace. ADR 0181 decision 5 found that `cmd.exe`, which runs every `.cmd` file on Windows,
  reads a double quote its own way.

## Decision

1. **`process:<name>` names one program, by its bare name.** `<name>` is 1 to 64 lowercase
   letters, digits, dots, hyphens and underscores, starting with a letter or a digit. A path, a
   wildcard and a system extension (`.exe`, `.com`, `.cmd`, `.bat`, `.ps1`, `.sh`) are refused at
   install, at the permission's field path. The host adds the extension its system runs, so one
   permission means one program on every system. Lowercase, because Windows and macOS ignore
   case in a file name and Linux does not. `host.process.start(name)` must equal a declared name
   exactly: `process:claude` does not start `claude-code`.

   **Per program, not per kind of access.** A person approving `process:claude` reads one name
   and knows which program it is. A second agent is one more line to approve, not a wider grant.
   A plugin that could start "any program" could start a shell, and a shell is everything.

2. **The prompt says it in words.** The permission list shows `process:claude: start the
program claude on your computer`. Below the list, a paragraph says the plugin may ask Tyto to start it, from
   the person's `PATH`, in the folder open in Tyto, never while that folder is restricted, and
   that the program runs with the person's rights and is not confined. The sentence about the
   plugin's own process now says it cannot start programs _itself_. The prompt is
   `permissionPrompt`, English, in the CLI and in the window's install box alike. The plugins
   screen, which is translated, says the same in one line per plugin (TYTO-568, second pull
   request).

3. **An update that adds a program is asked again, by the rule that already exists.** No new
   mechanism: `E_PLUGIN_PERMISSIONS_CHANGED` refuses to load it, and the sync and reinstall ask.
   A test pins the rule for `process:`.

4. **The plugin holds a handle to a long-lived program.** `host.process.start(name, args)`
   resolves to `{ write, end, kill, onStdout, onStderr, exited }`. `write` takes bytes or text,
   sent as UTF-8. `end` closes stdin. `kill` ends the program. `exited` resolves to
   `{ code, signal }`. The arguments are an array, and no shell reads them. Output that arrives
   before anybody listens is kept for the first listener, up to 1 MiB per stream, and then
   dropped, so a plugin that never reads stderr cannot grow the host's memory. One write is at
   most 1 MiB (`PROCESS_WRITE_LIMIT_BYTES`), because a write is a message, not a file. A write or
   an `end` after the program ended is `E_PROCESS_EXITED`.

5. **At most two of a plugin's programs run at once** (`PLUGIN_PROCESS_LIMIT`). A conversation is
   one. The second lets a plugin start the next program while the first is still exiting. A start
   counts from the moment it is asked, not from when the adapter answers, so two quick starts
   cannot both pass a count of one. **Two is a number to revisit, not a ceiling to defend.** A
   plugin that needs more asks for a new ADR with its case.

6. **The checks are the host's, in front of a port.** `checkedProcesses` refuses an undeclared
   name (`E_PERMISSION`), a host without the port (`E_PROCESS_UNAVAILABLE`, which is the CLI's
   answer), the limit and the size of a write. It ends everything when the plugin goes. The port
   is `HostCapabilities.startProcess(plugin, program, args, events)`, optional, and answers
   `{ write, end, kill }`. It reports `stdout`, `stderr` and exactly one `exit` through `events`.
   The in-process host ends a plugin's programs in `disposePlugin`. The isolated host ends them
   when it closes the plugin, when the plugin crashes or misses a deadline, and when activation
   is refused.

7. **Across the isolation boundary, protocol 19.** The guest asks with four requests:
   `processStart` with the name and the arguments, answered `{ id }`, then `processWrite`,
   `processEnd` and `processKill` by that id. The host sends `process` messages on its own, each
   `stdout` or `stderr` with bytes, and one last `exit` with `{ code, signal }`. Bytes cross as
   `Uint8Array`, as the cache's do. The guest keeps a program's output from the moment it hears
   it, because one read of a pipe can hold the program's first output, or even its end, before
   the answer to `processStart` is read. Each request keeps the 30 s deadline. The program itself
   has none, because a conversation can last an afternoon.

8. **The program runs in the desktop's main process**, never in the plugin's process, which Node
   cannot let start anything and which could skip a check made there. The adapter does the
   following:
   - **Finds the program on `PATH`**, with `PATHEXT` on Windows. It tries `.exe` and `.com`
     before `.cmd` and `.bat`, and never runs `.ps1`.
   - **Starts it without a shell.** A `.cmd` or `.bat` (an npm shim) is a script that only
     `cmd.exe` runs. The adapter runs it as `cmd.exe /d /s /c` with the shim's full path quoted,
     including a path with spaces. **Every argument is refused (`E_PROCESS_ARGUMENT`) when it
     holds a character `cmd.exe` gives a meaning of its own** (`" % ^ & | < > ( ) !`) or a line
     break, rather than escaped, for the reason ADR 0181 decision 5 gives. ACP's messages travel
     on stdin, so its arguments are short flags.
   - **Runs it in the open workspace folder.** With no folder open, it runs in the home folder.
     A restricted workspace is refused before the program is even looked for
     (`E_PROCESS_RESTRICTED`, ADR 0111). A program that starts in a folder reads that folder's
     files the way a shell does (ADR 0164 decision 5).
   - **Gives it an environment from an allowlist, not main's.** The allowlist is `PATH`, the
     home and user variables (`HOME`, `USERPROFILE`, `USER`, `USERNAME`, `LOGNAME`), locale
     (`LANG`, `LC_*`), temporary folders (`TMPDIR`, `TEMP`, `TMP`), and on Windows `SystemRoot`,
     `windir`, `ComSpec`, `PATHEXT`, `APPDATA`, `LOCALAPPDATA`, `ProgramData`, `HOMEDRIVE` and
     `HOMEPATH`. It adds the proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, either
     case) and `TYTO_WINDOW`. An agent CLI keeps its login under the home folder or `APPDATA`,
     which these reach.
   - **Passes no secret through the environment.** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
     anything ending in `_TOKEN` or `_KEY`, `TYTO_PLUGIN_*`, `ELECTRON_*` and `NODE_OPTIONS` are
     not on the list, and the adapter drops a name shaped like a secret even if a later change
     adds it. An agent that needs an API key uses its own login.
   - **Ends the program when the plugin stops, when the window closes, and when the workspace
     folder or its trust changes.** A program started for one folder does not go on reading
     another, and a folder that has just become restricted runs nothing.

9. **The program gets `TYTO_WINDOW` and nothing else of the window's.** `TYTO_WINDOW` is the
   window's process id, as in ADR 0181 decision 3. It is not a secret. An agent that registers
   the relay itself reaches this window. Handing the plugin the relay's command line, which
   ACP's `session/new` takes in `mcpServers`, is a service of its own and is left to TYTO-569.

## Consequences

- A plugin can drive an agent CLI over stdio for a whole conversation, and the person approved
  that one program by name. The CLI's login stays the CLI's.
- The install prompt no longer says, without qualification, that a plugin cannot start programs.
  It says that the plugin's process cannot, and what Tyto starts for it.
- The CLI starts no programs for plugins (`E_PROCESS_UNAVAILABLE`). A pipeline that needs one
  needs a new decision.
- Every isolated plugin and host pair speaks protocol 19. Both ship in the same app.
- A program a plugin starts is not confined. It runs as the person, with the person's files. The
  permission says which program, not what the program does.
- This card lands in two pull requests. The first holds this record, the contract in
  `@tyto/plugin-api`, the codes, the prompt, and the tests with a stand-in port. The second
  holds the desktop's adapter, the plugins screen line, the user manual, and a desktop test with
  a stand-in program. Until the second lands, no host has the port, and every start answers
  `E_PROCESS_UNAVAILABLE`.

## Left open

| What                                                           | Why it matters                                                  | Status       | Card     |
| -------------------------------------------------------------- | --------------------------------------------------------------- | ------------ | -------- |
| The relay's command line handed to a plugin, for ACP's servers | Without it the agent a plugin starts does not see the window    | Not decided  | TYTO-569 |
| A panel hearing pushed events from its plugin (ADR 0173 d8)    | A chat panel shows an answer as it streams                      | Not decided  | TYTO-569 |
| `testPlugin` offering a stand-in program                       | A plugin author tests `host.process` without a real program     | Not built    | —        |
| The real `claude` and ACP adapters started this way            | The suites run stand-ins that read and write stdio the same way | Not measured | —        |

## Note, 2026-11-09 — the desktop adapter (TYTO-568, second pull request)

`apps/desktop/src/main/plugin-programs.ts` is decision 8, composed in `index.ts`, and adds
three things the decisions above did not spell out:

- **"Restricted" means `restricted`, as for the terminal.** A trust taken back while the folder
  is open (`revoked`) keeps the folder trusted until it reopens (ADR 0111), so a program may
  still start in it. The programs already running end, because the trust they started under
  changed. `settle` compares the folder and the trust each program started under with the ones
  open now. It runs after a folder opens or closes, and after trust is granted or taken back.
- **A program ends with its whole tree.** On Windows that means `taskkill /T /F`, because an npm
  `.cmd` runs under `cmd.exe` and the program is that shell's child. Elsewhere it means the
  program's own process group, because the program starts detached.
- **On the way out, the kill is synchronous.** This was measured on Windows: with an
  asynchronous `taskkill`, closing the window left the program running. The program held the
  handles it inherited from main, and the test harness waited on them for 45 s. When the window
  closes or the app quits, `taskkill` now finishes before main goes on.

## Note, 2026-11-09 — the relay for ACP's servers (TYTO-569)

The first row of "Left open" is decided in ADR 0183: `host.window.agentServer()` answers the
window's MCP server in ACP's `mcpServers` shape, to a plugin that declares a `process:<name>`.
The prompt's `process:` paragraph (decision 2) gains a sentence saying that the program can also
reach the Tyto window as an agent.

## Note, 2026-11-09 — the folder a program runs in (TYTO-569)

ACP's `session/new` needs the agent's `cwd` as an absolute path, and a plugin cannot know it:
`host.workspace` takes paths relative to the open folder, and the plugin's process is confined
to its own folder (ADR 0049). Decision 8 already has the host choose that folder: the open
workspace, or the home folder with none open. So the host now says which one it chose.
`StartedProcess` and `PluginProcess` carry `cwd`, the absolute folder the adapter spawned the
program in, and `checkedProcesses` refuses and ends a program whose adapter reports none.
Across the isolation boundary the answer to `processStart` is `{ id, cwd }`, which is
protocol 21. The desktop reports the value it passed to `spawn`, so the two cannot disagree. The
path is not a secret to a plugin whose program already runs there. No rule changes: decision 8
still decides the folder, and this only reports it.
