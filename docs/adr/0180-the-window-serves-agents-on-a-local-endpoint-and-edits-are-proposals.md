# 0180 — The window serves agents on a local endpoint, and what an agent changes there is a proposal

Status: accepted · 2026-11-09 · TYTO-566 · builds on ADR 0179

## Context

`tyto mcp` (ADR 0179) gives an agent the files of a folder. It cannot see which brief is in front
of the person, what is selected, or the text of a tab that has not been saved; and it has no way
to put a change where the person's undo history and unsaved text live (TYTO-566, layer 2 of E24).
Only the running window holds that state: the renderer's `Workspace` and each tab's CodeMirror
`EditorState`, of which main receives a debounced `session:write` and nothing more.

Read on `origin/main` at d8365831, the desktop's main process listens on nothing an agent could
reach. It opens a one-shot HTTP server on loopback for a plugin's PKCE sign-in (ADR 0174), and
Chromium's debugging port only when started in verification mode (ADR 0178). It does not call
`requestSingleInstanceLock`, so several windows — several processes — can be open at once.

Five things had to be settled: how an agent reaches a window, how the window knows the caller
may talk to it, which window answers when several are open, what an agent may do to the window
without asking, and how a change to a document's text reaches it.

## Decision

1. **An agent reaches the window through `tyto mcp --window [folder]`, a relay on stdio.** The
   agent's host keeps registering one stdio command, as in ADR 0179; this one copies bytes
   between its stdin/stdout and the window's endpoint and reads no frame of its own. The window
   serves the protocol, with `createMcpServer` from `@tyto/command-line` over the connection:
   `serveMcp` takes a `Readable` and a `Writable`, and a `net.Socket` is both, so the transport
   needs no change. Stdout carries the window's frames and nothing else (ADR 0179 decision 7):
   which window was picked, and every failure, goes to stderr. **The window's command panel
   still refuses `mcp`**, `--window` included: the relay needs a person's stdio as much as the
   server does. Chromium's debugging port is not reused: it reaches every renderer's page with no
   notion of a tool, and it exists only in verification mode.

2. **The endpoint is a named pipe on Windows and a Unix socket elsewhere, announced by a record
   in `TYTO_HOME/windows/<pid>.json`.** The pipe is `\\.\pipe\tyto-<user>-<pid>`. The socket is
   `TYTO_HOME/windows/<pid>.sock`, unless that path passes 103 bytes — `sun_path` is 104 bytes on
   macOS and 108 on Linux, NUL included — when it is `<os.tmpdir()>/tyto-<user>/<pid>.sock`, in a
   folder the window creates with mode 0700. The record holds the version, the process id, the
   endpoint, the open workspace folder (or none), a random token and when the window started.
   **`TYTO_HOME`, not Electron's `userData`,** because the relay is the CLI, which never learns
   where Electron keeps its data, and `TYTO_HOME` is already the one folder both apps resolve the
   same way (`tytoHome()` in `apps/cli` and in the desktop's `plugin-list.ts`): the plugins, the
   trust approvals and the source cache live there too. The window removes its own record when
   it quits. A client skips a record whose process is gone — `process.kill(pid, 0)`, with
   `EPERM` read as alive — and never deletes it: a client deletes nothing it did not write.

3. **The token is the gate.** The window draws at least 128 random bits as hex when it starts
   listening and writes them into the record. A client's first line is
   `{"tyto":"window","version":1,"token":"…"}`; nothing else is read until it is answered. The
   window compares the token in constant time (`crypto.timingSafeEqual` over the SHA-256 of both,
   so a length cannot differ either) and answers `{"tyto":"window","ok":true,…}`, after which
   the connection carries MCP frames. A wrong token, a malformed line, another version and a
   first line over 4,096 bytes all get the same `{"tyto":"window","ok":false}`, with no reason,
   and the connection is closed. **Reading the record is what a caller needs, so the record is
   readable by its owner only:** on Unix it is written with mode 0600 inside a 0700 folder; on
   Windows it inherits the ACL of the person's profile, where `TYTO_HOME` lives by default. The
   pipe's own ACL is not claimed here: Node's `net` sets no DACL on a named pipe it creates, and
   Windows' default DACL may grant more than the owner. It is measured when the window starts
   listening (TYTO-566 PR 2), and that measurement amends this decision.

4. **With several windows open, the relay picks one and says which.** It serves the folder it
   is given (the current one by default, as in ADR 0179). The window whose workspace holds that
   folder answers — the deepest workspace when several do, then the most recently started; when
   none holds it, the most recently started window does. The relay names the window's folder and
   process id on stderr, with "no open window holds this folder" when it fell back.

5. **Changing a document's text is always a proposal.** An agent's edit to a document is shown in
   the document's tab as a change the person accepts or rejects. Accepted, it is **one undo
   step**, as `formatBrief` already makes its whole-document change one (`isolateHistory.of
('full')` in `packages/editor/src/format-brief.ts`). Nothing an agent sends is written to an
   open document, saved or not, without that acceptance, and no setting changes this.

6. **Actions that move the window without writing a file follow a new setting,
   `agents.windowActions`: `"propose"` (the default) or `"allow"`.** Opening a file in a tab and
   showing a format's preview are such actions. Under `"propose"` the person accepts or rejects
   each one, as a text proposal; under `"allow"` they happen directly. Rafael chose the default on
   2026-11-09. The setting lands with the window tools (TYTO-566 PR 3), in
   `apps/desktop/shared/settings.ts`.

7. **A restricted workspace, or none, gets reads only: no window action and no proposal,
   whatever the setting.** This is ADR 0179 decision 3 carried over: an agent acts on text it
   read, and a folder nobody trusted is text anybody could have written. The window offers it
   the reads (the brief in front, the selection, the file tools) and withholds every tool that
   proposes.

8. **The connection is announced and can be cut.** While an agent is connected the status bar
   says so; cutting it from there closes the connection, and the relay exits.

## Consequences

- An agent registers `tyto mcp --window` instead of `tyto mcp` to work with what is open; the
  file tools behave the same either way. Until the window listens (TYTO-566 PR 2) the option is
  hidden from `--help` and the generated reference, and answers that no window is open.
- `@tyto/command-line` holds the contract both sides import — the record's schema, the endpoint's
  name, the handshake, the pick (`src/mcp/window-endpoint.ts`) — so the window and the relay
  cannot drift apart.
- The relay loads no MCP SDK: it copies bytes. The window loads it, and how its main bundle does
  so, given ADR 0179 kept the package external, is settled in PR 2.
- The proposal model needs no `@codemirror/merge`: a proposal is a decoration over the tab's text
  with accept and reject, applied as one transaction (TYTO-566 PR 4). Taking the merge package
  instead would be a stack change, with its own ADR.
- A process of the same person that can read `TYTO_HOME` can drive the window, as it can already
  run `tyto` with that person's plugins and credentials. The gate keeps out other users and
  anything that cannot read the person's files; it is not a sandbox against the person's own
  programs.
