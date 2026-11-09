# 0183 — A plugin gets the window's agent server for the program it starts

Status: accepted · 2026-11-09 · TYTO-569 · builds on ADR 0180, ADR 0181 and ADR 0182

## Context

TYTO-569 is an agent panel plugin. It drives an agent CLI over the Agent Client Protocol (ACP)
and starts it through `process:<name>` (ADR 0182). ACP's `session/new` takes the MCP servers the
agent should connect to, `mcpServers`. Each stdio entry is `{ name, command, args, env }`, and
`env` is a list of `{ name, value }` (agentclientprotocol.com/protocol/session-setup, read on
2026-11-09). The spec requires every agent to support stdio servers. The window's tools, which
read the brief in front and propose edits (ADR 0180), are reached through the relay that
Open an Agent Here registers (ADR 0181): the bundled Node, `out/relay/agent-relay.js`, and
`TYTO_WINDOW` and `TYTO_HOME` in its environment.

A plugin cannot write that entry itself. The bundled Node's path and the relay's path depend on
whether the app is packaged and where it is installed. `TYTO_HOME` is the host's. The plugin's
own process is confined to the plugin's folder and cannot look (ADR 0049). ADR 0182 decision 9
left this service to TYTO-569.

Read on `origin/main` at 159b5c1e:

- `terminal-agent.ts` already builds the relay's description for Claude Code's `--mcp-config`
  and Codex's `-c` overrides, from `agentRelayPaths`, the window's process id and `TYTO_HOME`.
- `agentsListen` (default on) decides whether the window's endpoint listens. Open an Agent Here
  refuses to start an agent while it is off.
- The window's token is in its record in `TYTO_HOME`, mode 0600, never on a command line or in
  an environment (ADR 0180 decision 3).

## Decision

1. **`host.window.agentServer()` answers the window's MCP server in ACP's shape.** The answer is
   `{ name: 'tyto', command, args, env }`: the bundled Node, the relay's script, and `env`
   holding `TYTO_WINDOW` and `TYTO_HOME`. The plugin sends it to the agent inside `session/new`,
   as JSON on stdin, so no command line carries it and ADR 0181 decision 5's quote rule does not
   apply. Asked again on every call, because the setting and the folder's trust can change
   between two conversations. The name `tyto` is the one Open an Agent Here gives the relay.

2. **No permission of its own. It answers a plugin that declares at least one
   `process:<name>`, and refuses any other with `E_PERMISSION`.** Three reasons, decided with the
   batch's coordinator on 2026-11-09:
   - The answer carries no secret. The window's token stays in its record (ADR 0180 decision 3),
     and paths and a process id are not secrets.
   - Without a program to hand it to, the answer is of no use. The plugin's own process is
     confined (ADR 0049) and cannot run the relay.
   - With a program, the answer adds nothing that program could not reach already. A program a
     plugin starts is not confined. It gets `TYTO_WINDOW` (ADR 0182 decision 9) and could find
     the relay and the record itself. A second permission would be one more line to approve that
     grants nothing the first one does not.

   **The person learns it at install instead.** The prompt's `process:` paragraph (ADR 0182
   decision 2) gains one sentence, in the CLI and in the window's install box alike:

   > That program can also reach the Tyto window as an agent while Tyto lets agents connect
   > (setting `agentsListen`): it reads what is open there, and its edits arrive as proposals
   > you approve or reject.

   With several programs it reads "Those programs can also reach the Tyto window as agents… they
   read… their edits…". A plugin with no `process:` permission never sees the sentence. The
   setting is named in words first, because a person installing a plugin does not know its key
   (wording fixed with the coordinator on 2026-11-09).

3. **The checks are plugin-api's, in front of a port, as for every capability.**
   `checkedWindowAgentServer` checks the permission, then the port: a host without
   `HostCapabilities.windowAgentServer` answers `E_WINDOW_UNAVAILABLE`, which is the CLI's
   answer. Then it checks the adapter's answer with `agentServerSchema`, a strict schema, so an
   adapter's extra field never reaches a plugin. **Its `env` may hold `TYTO_WINDOW` and
   `TYTO_HOME` and nothing else** (`AGENT_SERVER_VARIABLES`). This is an allowlist, not ADR 0182's
   secret-shaped names, because the answer has exactly one job. An adapter that one day adds an
   API key there is refused by the check, not trusted to remember. The in-process host and the
   isolated host share the one function.

4. **The desktop's adapter refuses what only it can see**, in this order:
   - A restricted folder answers `E_WINDOW_RESTRICTED`, as the terminal and a plugin's program
     are refused (ADR 0164 decision 5, ADR 0182 decision 8).
   - `agentsListen` off answers `E_WINDOW_AGENTS_OFF`, as Open an Agent Here refuses.
   - Otherwise it answers. With no folder open it still answers, and the agent gets the window's
     reads only (ADR 0180 decision 7).

   The adapter is `windowAgentServerPort` in `terminal-agent.ts`, beside `claudeConfig`, and it
   reads the same `agentRelayPaths`. One relay serves both doors.

5. **Three codes, not a reuse of `E_PROCESS_RESTRICTED`.** That code's message names a program,
   and this call names none. A panel can tell "turn agentsListen on" from "trust the folder" from
   "this host has no window" by the code alone.

6. **Across the isolation boundary, protocol 20.** The guest asks `windowAgentServer` with no
   arguments, and the answer crosses through the same strict schema. A host on 19 would refuse
   the request as an unknown capability.

## Consequences

- A plugin's agent reaches the window that started it, with the same tools and the same
  proposals as an agent in a Tyto terminal. Edits still go through the person (ADR 0180).
- Every plugin that declares a program now has its prompt say that the program can reach the
  window. That includes a plugin whose program is not an agent. The sentence is true of any
  unconfined program the plugin starts, so it stays.
- The CLI answers `E_WINDOW_UNAVAILABLE`: `tyto` has no window, and `tyto mcp` is a separate,
  read-only door (ADR 0179).
- `testPlugin` needs no new option: a plugin author passes `windowAgentServer` in
  `capabilities` to stand in for the window.
- The relay's stderr line says "relaying to the window that started this terminal" when
  `TYTO_WINDOW` is set, which is also true of a plugin's agent, where no terminal is involved.
  The line is a log, not a contract, and is left as it is.

## Alternatives rejected

| Alternative                                          | Why not                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A permission of its own (`window:agents`)            | Grants nothing an approved program lacks (decision 2); one more line for the person    |
| Answer any plugin, with or without a program         | The plugin's own process cannot use it; answering it there would only widen what leaks |
| Put the relay on the program's `PATH` as `tyto`      | ADR 0181 decision 1 keeps `tyto` off `PATH`; and ACP takes the server in `session/new` |
| Write an MCP configuration file and pass its path    | ACP has no such argument. The JSON on stdin is the protocol's own place for it         |
| Reuse ADR 0182's secret-shaped name filter for `env` | An allowlist of the relay's two variables is stricter and exactly what the relay reads |

## Left open

| What                                                        | Why it matters                                                | Status       | Card     |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ------------ | -------- |
| The plugins screen's translated line naming the window      | The screen says what a program may start, not what it reaches | Not built    | TYTO-569 |
| A panel hearing pushed events from its plugin (ADR 0173 d8) | A chat panel shows an answer as it streams                    | Not decided  | TYTO-569 |
| The real ACP adapter connecting through this server         | The suites run a stand-in that speaks MCP to the relay        | Not measured | TYTO-569 |
