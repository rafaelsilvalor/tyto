# 0179 — `tyto mcp` serves read tools on stdio, and a restricted folder gets no write tool

Status: accepted · 2026-11-09 · TYTO-565 · builds on ADR 0111 and ADR 0159

## Context

An AI agent outside Tyto (Claude Code, Claude Desktop) should be able to see the templates of a
project, check a brief and look at its artwork before showing it to anybody (TYTO-565, layer 1 of
E24). The Model Context Protocol is how those agents reach a local tool: the agent's host starts a
program and speaks JSON-RPC to it over the program's stdin and stdout, one message per line.

The command tree and its file access live in `@tyto/command-line` since ADR 0159, with every
capability a port an app fills. Four questions had to be settled: where the protocol runs, which
tools exist, what a folder nobody trusted may let an agent do, and what never leaves through a
tool. Building it showed a fifth: stdout must carry protocol frames and nothing else, and a
plugin's process inherited that stdout (`stdio: ['ignore', 'inherit', …]`), so a plugin's
`console.log` went into the middle of the protocol — and into `tyto render --json`'s one
document, which it had already been able to break.

## Decision

1. **`tyto mcp` serves on the standard streams of whoever started it, through a port.**
   `CliEnvironment.stdio` hands the two streams over; only `apps/cli` fills it, with
   `process.stdin` and `process.stdout`. Without the port the command fails as an internal
   failure (exit 2) and says why. **The window refuses `mcp`** before it starts (exit 1,
   `MCP_REFUSED`, the refusal of ADR 0159 decision 2): its command panel is not a pipe, and an
   agent registers the command with its own host, which starts it. **`tyto mcp [folder]` serves
   the folder it names**, the current one by default: a host may start the server in a folder of
   its own choosing (Claude Desktop names none), and the argument makes the answer not depend on
   it.

2. **The tool list is closed and every tool is either a read or a write.** `MCP_TOOLS` in
   `packages/command-line/src/mcp/tools.ts` names each tool and its access; the server registers
   exactly what `toolsFor(trust)` answers, and nothing else. A read changes no file and starts no
   shell; a write changes a file. This decision ships four reads and no write:
   - `list_templates` — every template a brief in the folder can name: name, version,
     description, format ids.
   - `describe_template` — one template's formats with their sizes, its slots and adjustments,
     and the skeleton a new brief starts from (`templateSkeleton`, the text `tyto delivery new`
     writes, so the two never disagree).
   - `check_brief` — the job run to SVG in memory: no browser, nothing fetched, no file written.
     It answers about the brief's **structure, not its fonts or remote images**, and its
     description says so; a preview can still add those warnings. Two guards keep it off the
     network, each enough alone: Google Fonts is not registered for a check, and the source
     cache is opened with `fetches: false`.
   - `render_preview` — one format to PNG, returned as MCP image content, with the diagnostics.

   Writes (a brief, a delivery, an export), prompts and resources, and running a recipe are later
   cards; each new tool enters `MCP_TOOLS` with its access.

3. **New rule: a restricted workspace is offered no tool that writes.** This is stricter than
   ADR 0111, which lets a restricted folder be rendered and written to by a person who typed the
   command. An agent is not that person: it acts on text it read, and a project folder is text
   anybody could have written. So in a restricted folder — and outside any workspace, where
   nothing is trusted — the server registers only the reads, and the agent never sees a write
   tool to call. Trusting the folder (`tyto trust add`, or **Workspace: Trust** in the window) is
   what offers them. Everything ADR 0111 already withholds is withheld here the same way, because
   the session loads the workspace with the CLI's own code: a restricted folder's sections and
   its plugin files are not loaded, and the line that says so goes to stderr.

4. **Nothing secret leaves through a tool.** No result carries a credential, a value of
   `variables` (the environment `TYTO_PLUGIN_*` credentials are read from), or a project section's
   values. Results are templates' manifests, located diagnostics and PNG bytes. The session hands
   plugins what `tyto render` hands them; it never returns it.

5. **Paths stay inside the folder the server was started in and its workspace.** A path an agent
   gives is checked as typed before the disk is touched, so a path outside gets one answer
   whether or not a file is there — "outside", never "no such file", which would tell an agent
   what exists beyond the folder — and then as its real path, so a link inside that leads out is
   refused as where it leads. A brief can also be handed over as text.

6. **A preview is at most 1,024 px on its longest side and at most four artworks.** The scale is
   `min(1, 1024 / longest side of the format)`: a large frame is shrunk, a small one never
   enlarged, and the agent cannot ask for more. A 1080 × 1920 story at full size is megabytes of
   base64 in the agent's context; at the ceiling it is a fraction. One Chromium serves the session,
   started by the first preview and closed when the client disconnects. A client's cancellation
   reaches the job as its `AbortSignal` (ADR 0159 decision 6): the frame in flight finishes and
   no further frame starts.

7. **Stdout carries protocol frames and nothing else.** Three things make it so. The commands the
   session reuses print through a console whose two streams both go to stderr. `apps/cli`'s port
   gives the protocol a stream of its own over stdout's original `write`, then replaces stdout's
   `write` with stderr's, so `console.log` and a library writing to `process.stdout` land on
   stderr. And **a plugin's process gets the parent's stderr as its stdout** (`plugin-process.ts`,
   fd 2), which also stops a plugin's output from breaking `tyto render --json`. The desktop starts
   plugins through its own launcher (`apps/desktop/src/main/plugin-process.ts`), whose stdout is
   no protocol, and is unchanged.

8. **Stack change: `@modelcontextprotocol/server` 2.x.** The official TypeScript SDK's v2 server
   package has no peer dependencies and depends only on `zod` ^4 (already in the workspace) and
   `@modelcontextprotocol/core`; its stdio transport is the `./stdio` export. The 1.x
   `@modelcontextprotocol/sdk` was not taken: it brings peers and an HTTP stack (express, hono)
   that a stdio server never runs. Only `tyto mcp` imports the SDK, lazily, so tsup puts it in a
   chunk of its own; the desktop's main bundle keeps the package external, as it does
   `playwright`, because the window refuses the only command that reaches it.

## Consequences

- Claude Code and Claude Desktop register `tyto mcp` as a stdio server (`docs/agents.md`, and
  the manual's command-line section in both editions).
- A trusted folder and a restricted one offer the same four tools today; the rule bites when the
  first write tool lands, and `toolsFor` is tested with one already.
- `check_brief` and `render_preview` can disagree on warnings about fonts and remote images; the
  tool descriptions say which one fetches.
- A brief handed over as text resolves its images against the server's folder; an image path in
  it is read the way `tyto render` reads one, within the asset resolver's own rules, not this
  ADR's path check.
- Measured on 2026-11-09, `apps/desktop/out/main` before and after: 4,422,710 → 4,437,404 bytes
  (+14,694: 9,683 in `index.js`, 5,011 in the stub chunk). Bundled instead of external, the SDK
  was a 694,040-byte chunk main never loads.

## Amendment — 2026-11-09, TYTO-652

Two tightenings within decisions 3 and 5; the rules do not change.

- **The images a brief cites stay inside the folder too.** `briefAssetResolver` already refused
  an image path that climbs out as written (`../`, an absolute path), with one answer for a file
  that is there and one that is not; it reads no link's target, by design (`contain.ts`: a
  mistake boundary, not a sandbox). So through a link inside the folder an image from outside was
  drawn into a preview, and a missing one answered differently. `tyto mcp` now follows each file
  an image resolved to to its real path (`real-path-assets.ts`, `RenderTask.assetRoots`), and one
  outside the folder, its workspace and the workspace's asset folders answers
  `E_ASSET_NOT_FOUND`, exactly as a missing file. What a plugin source fetched lives in
  `TYTO_HOME`'s cache and is not checked: nobody typed that path. `tyto render` and `tyto watch`
  keep the mistake boundary alone, links followed.
- **A preview fetches only in a trusted workspace.** `check_brief` still fetches nothing.
  `render_preview` asks a plugin's `asset-source` or `font-source`, Google Fonts included, only
  when the workspace is trusted; elsewhere it draws what the cache already holds and says why a
  miss was not fetched. This is stricter than `tyto render`, which also fetches outside any
  workspace: there an agent naming references would pull the person's images from a connected
  service, through their credentials, into its own context, and nothing was trusted. There is no
  `https:` image yet (TYTO-559 to TYTO-561); such a scheme would fall under this rule.

## Amendment — 2026-11-09, TYTO-566

ADR 0180 changes the last sentence of decision 8: the window now serves agents on its own
endpoint, so the desktop's main bundle no longer keeps `@modelcontextprotocol/server` external.
It is bundled into the lazy chunk that loads when the first agent connects; ADR 0180's amendment
has the sizes.
