# 0184 — A plugin runs its own program on Tyto's Node, and opens a terminal for it

Status: accepted · 2026-11-10 · TYTO-657 · extends ADR 0182 · builds on ADR 0049, ADR 0050,
ADR 0111, ADR 0164 and ADR 0183

## Context

The agent panel (TYTO-569, `tyto-plugin-agent`) talks to Claude Code through an Agent Client
Protocol (ACP) adapter, `@agentclientprotocol/claude-agent-acp` (Apache-2.0). Before this ADR a
person had two steps outside Tyto: install the adapter with `npm i -g`, and sign Claude Code in
from a terminal. TYTO-657 removes both. Measured on 2026-11-10, on Windows:

- **The login command has changed.** Claude Code 2.1.321 signs in with `claude auth login`
  (`--claudeai` for a subscription, `--console` for API billing), not only `/login` inside a
  session. The adapter knows it. When a client says it can run a terminal
  (`clientCapabilities.auth.terminal`), `initialize` lists `authMethods` of type `terminal`,
  such as `{ id: "claude-ai-login", args: ["--cli", "auth", "login", "--claudeai"] }`. That means
  "run me again with these arguments, in a terminal": `--cli` makes the adapter hand the rest to
  the Claude CLI.
- **A login needs a terminal.** It prints a link, opens the browser on Anthropic's page, waits
  for the browser to come back, and may ask for a code to paste. A program behind `host.process`
  has pipes, and nobody sees it.
- **The adapter does not use the person's `claude` by default.** It runs
  `CLAUDE_CODE_EXECUTABLE` when that is set. Otherwise it runs the binary of the SDK's platform
  package, which is 331 MB on `win32-x64`. The adapter itself, bundled into one file by
  esbuild, is 3,802,941 bytes (854,139 gzipped). The plugin without it is 65,298 bytes. Given
  `CLAUDE_CODE_EXECUTABLE` pointing at the installed `claude.exe` and run on Node 24.15.0, that
  file answered `initialize` and reported the signed-in account.
- **ADR 0182 starts programs from `PATH` only.** A plugin can start the adapter only if the
  person installed it. A plugin cannot run a file of its own: its process is confined to its
  folder by Node's permission model and starts nothing (ADR 0049).
- **A plugin installs by copying its folder** (ADR 0151's rule for fetched plugins), so a
  script inside that folder reaches the person's disk as the plugin's other files do.

## Decision

1. **A manifest may map a declared program to a script of its own: `programs`.**
   `"programs": { "claude-agent-acp": "adapter/claude-agent-acp.mjs" }`. Each key is a program
   name the manifest already declares as `process:<name>`. ADR 0182's rules for that name apply
   unchanged, and a key without its permission is refused at install, at `programs.<name>`.
   **No new permission.** The person approves `process:claude-agent-acp` as before. The prompt
   now says which kind of program it is (decision 5).

2. **The script is a relative path inside the plugin's folder.** It is checked twice:
   - **By spelling, in `@tyto/plugin-api`**: forward slashes, no `.` or `..` segment, no leading
     slash or drive, only letters, digits, `.`, `_` and `-` in each name, ending in `.mjs`,
     `.cjs` or `.js`, at most 200 characters (`programScriptProblem`).
   - **On the disk, by the host**, after resolving links: the real path must lie inside the
     plugin's real folder and be a file. Otherwise the start is `E_PROCESS_SCRIPT_MISSING`,
     which tells the person to reinstall the plugin. It is not `E_PROCESS_NOT_FOUND`, which says
     "not on PATH".

3. **The host runs that script on its bundled Node** (ADR 0050), the one that runs plugins and
   the relay (ADR 0181), as `node <script> <args…>`. It does not look the name up on `PATH`. A
   name with no `programs` entry still comes from `PATH`, exactly as in ADR 0182. The port
   learns which is which: `startProcess(plugin, program, args, events, script?)`, with `script`
   the plugin-relative path. Everything else in ADR 0182 decision 8 holds: the open folder as
   the working folder (the home folder with none open), refused before anything is looked for
   while that folder is restricted (`E_PROCESS_RESTRICTED`), the environment allowlist with
   `TYTO_WINDOW` and no secret-shaped name, no shell, and the whole tree ended when the plugin
   stops, the folder or its trust changes, or the window closes. `NODE_OPTIONS` was already off
   the allowlist, so nothing in main's environment changes how that Node starts.

4. **The trust difference, stated plainly.**
   - A program from `PATH` is code the person installed themselves. Tyto starts it, and the
     person chose to trust that code when they installed it.
   - A `programs` script is **the plugin's own code, running on Tyto's Node with a full
     process's reach**. Node's permission model is not applied to it. The plugin's own process
     cannot read the person's files, but its script can, can change them, and can reach the
     network, as any program the person runs can.

   **What still confines it:** the path (decision 2: only a file inside the plugin's folder,
   checked after links); the folder rules of ADR 0182 (the open folder as working folder, never
   while it is restricted); the environment allowlist (no API key, token, `TYTO_PLUGIN_*` or
   `ELECTRON_*`); the limit of `PLUGIN_PROCESS_LIMIT` (2) programs at once; the lifetime rules;
   and the fact that the script is fixed at install. An update that changes the file is a new
   version of the plugin. An update that adds a program is asked again (ADR 0182 decision 3).

   **What does not confine it:** anything about what the code does once it runs. Tyto does not
   sandbox the script, does not read it, and cannot tell a faithful copy of the adapter from a
   rewritten one. The person is trusting the plugin's author with their account's rights. A
   plugin that ships a program asks for that trust in its prompt, in words.

   This is no wider than what a person who approves `process:<name>` already grants: an
   installed program is not confined either (ADR 0182). It is a different source of code. The
   prompt says so instead of hiding it behind the same sentence.

5. **The install prompt says it, for a non-coder.** The permission line reads
   `process:claude-agent-acp: run this plugin's own program claude-agent-acp
(adapter/claude-agent-acp.mjs) on Tyto's Node`, and the paragraph below the list adds:

   > `claude-agent-acp` is the plugin's own code, a script that came with it. Tyto runs it on
   > the Node it ships with, in the folder open in Tyto, and never while that folder is
   > restricted. Unlike the plugin's process, it is not confined: it can read and change your
   > files and reach the network, as any program you run can. Tyto runs it only from the
   > plugin's folder, passes it no API key or token from its own environment, and runs at most
   > 2 of the plugin's programs at once.

   The "found on your PATH" sentence names only the programs that come from `PATH`, and does
   not appear for a plugin that has none.

6. **A plugin may open a terminal tab running a program it declares: `host.terminal.open(name,
args)`.** The tab is a Tyto terminal (ADR 0164): a pseudo-terminal in main, shown in the
   window, which the person sees, types into and closes. The program is found as decision 3
   says, from `PATH` or as the plugin's own script, under the same refusals with the same
   codes. ADR 0182 decision 8's argument rule holds as well: an npm `.cmd` from `PATH` still
   goes through `cmd.exe`, and an argument `cmd.exe` would read is refused. **No new
   permission**: the person approved the program by name, and a tab hides nothing it does.
   - **The plugin hears that the tab opened, and nothing after.** No output and no exit cross
     back. What the person types into a login never reaches the plugin, and the plugin learns
     the result from the program's own state next time it asks: the agent's next `initialize`
     reports the account. A panel retries when the person comes back to it.
   - **One open tab per plugin** (`PLUGIN_TERMINAL_LIMIT`), counted from the ask, and freed
     when the tab's program ends or the person closes it. A second ask meanwhile is
     `E_TERMINAL_LIMIT`, whose message tells the person to finish or close the open tab.
   - **The tab outlives the plugin.** It is the person's. A tab running a login is not ended
     when the plugin stops or the folder changes. The person closes it, as any terminal
     (ADR 0164).
   - **The checks are plugin-api's, in front of a port**: `checkedTerminal` refuses an
     undeclared name (`E_PERMISSION`), a host without the port (`E_TERMINAL_UNAVAILABLE`, which
     is the CLI's answer) and the limit. The port is
     `HostCapabilities.openTerminal(plugin, program, args, script?)`, which answers
     `{ closed }` once the tab is open.

7. **Across the isolation boundary, protocol 22.** The guest asks `terminalOpen` with the name
   and the arguments and is answered `null`. `closed` stays on the host's side, where the count
   is kept. The manifest's `programs` is read by the host from the manifest it validated,
   never from the guest.

## Consequences

- With `programs`, an agent panel can ship its ACP adapter inside the plugin. A person installs
  Claude Code and the plugin, and nothing else. The panel can open the CLI's own login in a tab,
  where the browser opens on Anthropic's page. Tyto never sees, reads or stores the credential.
- A plugin that ships a program asks the person to trust its code with their rights, and the
  prompt says that in words. A plugin that uses only `PATH` programs reads as before, plus one
  sentence about the terminal tab.
- The CLI answers `E_TERMINAL_UNAVAILABLE` and still starts no program (`E_PROCESS_UNAVAILABLE`).
- Every isolated plugin and host pair speaks protocol 22. Both ship in the same app.
- **This card lands in two pull requests.** The first holds this record, the contract in
  `@tyto/plugin-api`, the codes, the prompt, and the tests with stand-in ports. The second holds
  the desktop: the bundled Node behind `startProcess`, the `openTerminal` port with a tab the
  window adopts, the plugins screen's line, the user manual in both editions, and a desktop
  test with a stand-in program. Until the second lands, no host has `openTerminal`, and a
  `programs` start on the desktop finds the name on `PATH` as before.

## Alternatives rejected

| Alternative                                                           | Why not                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A permission of its own for the plugin's script (`node:<script>`)     | The person already approves the program by name. The prompt's words, not a second line, carry the difference |
| Ship the SDK's 331 MB Claude binary with the plugin                   | Per platform, every update. The person's own `claude` is already installed and signed in                     |
| Keep `npm i -g` of the adapter as a prerequisite                      | The step TYTO-657 removes. It also needs npm, which a person who installed Claude Code natively lacks        |
| Run the login through `host.process` and pipe its output to the panel | The login reads a terminal, and the plugin would see what the person types                                   |
| A `process:<name>` for `claude` too, and open `claude auth login`     | One more program to approve. The adapter already runs the CLI with the arguments it advertises               |
| Report the terminal's output or exit to the plugin                    | Nothing the plugin needs. The next `initialize` reports the login, and the person's typing stays theirs      |

## Left open

| What                                                               | Why it matters                                                             | Status       | Card     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------ | -------- |
| The desktop's adapter: bundled Node behind `startProcess`, the tab | Until it lands, `programs` and `host.terminal` do nothing on the desktop   | Built        | TYTO-657 |
| The plugin shipping the adapter and the login button               | The person still installs the adapter until `tyto-plugin-agent` uses this  | Not built    | TYTO-657 |
| A real login, end to end, through the tab                          | The suites use a stand-in program                                          | Not measured | TYTO-657 |
| `testPlugin` offering a stand-in terminal                          | A plugin author tests `host.terminal` by passing `openTerminal` themselves | Not built    | —        |

## Note, 2026-11-10 — the desktop's adapter (TYTO-657, second pull request)

`plugin-programs.ts` runs a `programs` script on the bundled Node that the relay uses
(`agentRelayPaths().node`) and checks its real path with `pluginScriptFile`. `terminalLaunch`
gives a terminal the same file under the same refusals. For a `.cmd` from `PATH`, it hands
node-pty the file as it is and checks each argument as ADR 0181 decision 5 does. Main opens the
tab itself through `Terminals.openProgram` and pushes `terminal:opened`, carrying only the id.
The window adopts the tab through `terminal:list`, as it does after a reload, and puts the
Terminal tab in front. The plugins screen lists a plugin's own programs on a line of their own.
`plugins:list` carries their names as `ownPrograms`.

## Note, 2026-11-10 — a data folder, and what a program downloads (TYTO-666)

ADR 0187 gives every program a plugin starts a data folder in `TYTO_PROGRAM_DATA`, kept across
updates and deleted with the plugin. It amends decision 4: a script that downloads code keeps
"fixed at install" in substance only when the plugin's release commits the hash of everything it
fetches, and the script refuses anything else.
