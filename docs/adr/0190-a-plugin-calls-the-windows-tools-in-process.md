# 0190 — A plugin calls the window's tools in process

Status: accepted · 2026-11-10 · TYTO-661 · builds on ADR 0180, ADR 0183 and ADR 0042

## Context

TYTO-661 adds a second driver to the agent panel plugin (tyto-plugin-agent): the Claude API with
the person's own key, instead of a subscription CLI over ACP (TYTO-569). On the maintainer's work
machine the organisation's `allowedMcpServers` keeps Claude Code from starting the `tyto` MCP
server (TYTO-658), so the ACP path there has no Tyto tools at all. A driver on the API needs the
same tools the window serves an agent (TYTO-565, TYTO-566), and has no program to hand an MCP
server to: the plugin's own process makes the requests.

Read on `origin/main` at 9bc6f970:

- `host.window` answers `agentServer()` only (ADR 0183): an MCP stdio entry for a program the
  plugin starts. It answers a plugin that declares a `process:<name>`, and the plugin's own process
  is confined (ADR 0049) and could not run the relay anyway.
- The window serves its tools with `serveAgent` from `@tyto/command-line`, once per connection to
  its endpoint, over a `Readable` and a `Writable` (ADR 0180 decision 1), with the window's
  `WindowPort` for what is in front and for proposals.
- The tools offered depend on the open folder's trust, read when a session opens (`toolsFor`).

## Decision

1. **`host.window.tools()` and `host.window.callTool(name, input)`.** `tools()` answers
   `{ name, description, inputSchema }` for each tool the window serves an agent now;
   `callTool` answers `{ content, isError }`, where `content` is text and images (a preview, as
   base64), as MCP's content says them. A tool's own refusal — a brief that does not parse, an
   edit whose expected text changed — is an answer with `isError: true`, for the model to read,
   not an exception. An unknown tool or arguments the server refuses are answered the same way,
   because they are the model's mistake. The window's own refusals are thrown.

2. **The same server, with nothing between.** The desktop answers each call by opening a
   session on the very `serveAgent` its endpoint runs, with the window's `WindowPort`, over two
   in-memory streams instead of a socket. It speaks MCP's stdio framing through `initialize`,
   asks one question, and closes the session. So the tools, the trust that decides which are
   offered, and the proposals are exactly what an agent connected to the window gets: **an edit
   to a document's text is a proposal the person accepts or rejects** (ADR 0180), and a write
   tool follows ADR 0185. There is no second list of tools to drift, and `packages/command-line`
   does not change. No socket, no token and no record: the plugin is already the host's, and its
   permission is checked in front. One session per call, not one per plugin, because the folder
   and its trust can change between two calls and a session reads them when it opens. A listing
   that does not answer in 30 s and a call that does not answer in 180 s (a preview or an export
   of a large brief) are given up, and the session is ended (ADR 0042: a call has a deadline).

3. **Behind its own permission, `window:tools`.** Unlike ADR 0183's answer, which grants nothing
   a program could not reach itself, this one lets the plugin's own code read what is open in the
   window and propose edits, so the person approves it by name. The install prompt says, in the
   CLI and in the window's install box alike:

   > `window:tools`: use Tyto's tools in the open window: read what is open there and propose
   > edits you accept or reject, while Tyto lets agents connect (setting `agentsListen`).

   A `process:<name>` does not grant it, and `window:tools` does not grant `agentServer()`.

4. **The same refusals as the agent server, read on every call** (ADR 0183 decision 4): a
   restricted folder is `E_WINDOW_RESTRICTED`, `agentsListen` off is `E_WINDOW_AGENTS_OFF`, a host
   with no window — the CLI — is `E_WINDOW_UNAVAILABLE`. With no folder open the window still
   answers, with its reads only (ADR 0180 decision 7). The three codes' messages now say "asked to
   reach the window", which fits both services; their codes and parameters do not change.

5. **The checks are plugin-api's, in front of two optional ports**, as for every capability:
   `checkedWindowTools` checks the permission, then a tool name as MCP bounds it (1–128 of
   `A–Z a–z 0–9 _ . -`) and an input that is a JSON object, before the adapter is asked; then it
   passes the adapter's answer through strict schemas (`windowToolSchema`,
   `windowToolResultSchema`), so a field the window one day adds never reaches a plugin unread.
   The ports are `HostCapabilities.windowTools(plugin)` and
   `HostCapabilities.callWindowTool(plugin, name, input)`. The in-process host and the isolated
   host share the one function.

6. **Across the isolation boundary, protocol 23.** The guest asks `windowTools` with no arguments
   and `windowCallTool` with a name and an object; the answers cross through the same strict
   schemas. A host on 22 would refuse either as an unknown capability.

## Consequences

- A plugin can drive any model with the window's tools without MCP, so a policy that limits a
  CLI's MCP servers does not reach it. The tools are not more powerful for it: same trust, same
  proposals, same `agentsListen`.
- A plugin's sessions are not connections to the endpoint, so the status bar's count of connected
  agents does not include them. Each session writes the window's usual start line to the log,
  naming the plugin.
- A session per call costs a session's opening each time. Measured on the maintainer's machine
  against the real server in a temporary test (Vitest, a temporary untrusted folder, 10 rounds
  after 2 warm-up, 2026-11-10): a listing has a median of 4.5 ms (max 5.0) and a `check_brief`
  call on a one-line file 13.6 ms (max 25.4), session included. Against a model turn of seconds
  that is noise; a session kept for a turn would be a later decision, not a change of contract.
- Content other than text and images (an audio block, a resource) reaches the plugin as one line
  of text saying it was there. No tool the window serves answers one today.
