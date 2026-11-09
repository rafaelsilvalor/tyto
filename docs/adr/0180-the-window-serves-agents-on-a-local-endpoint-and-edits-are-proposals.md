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

## Amendment — 2026-11-09, TYTO-566 PR 2

The window listens. Four things were settled or measured on the way; decisions 1 to 8 stand.

- **The window listens whenever it is open, restricted folder included.** That is what makes an
  agent useful: it reaches the window the person is working in, with no step to turn it on. In a
  restricted workspace, or with no folder open, the tools offered are the reads, as decision 7
  says. The setting that comes with the window tools (TYTO-566 PR 3) gets an off switch beside
  `agents.windowActions`: `agents.listen`, `true` by default; `false` neither listens nor writes
  a record. The coordinator decided this on 2026-11-09.
- **The MCP SDK is bundled into main, in a lazy chunk.** This changes the last sentence of ADR
  0179 decision 8, which kept `@modelcontextprotocol/server` external to main because the window
  refused the only command that reached it. The window now serves agents itself, and the packaged
  app ships no `node_modules` the package could be imported from (`electron-builder.yml`
  excludes them and re-includes a named few). So the package leaves `external` and Rollup puts it
  in the chunk `server.js` already was, loaded when the first agent connects and never at start.
  Measured with `electron-vite build`, `apps/desktop/out/main` before and after: 4,454,493 →
  5,145,376 bytes; the chunk grew from 5,035 to 694,064 bytes, `index.js` by 1,854. The packaged
  suite connects to the packaged app and has `tools/list` answered, which is what shows the chunk
  loads from inside `app.asar`.
- **The protocol starts reading after the handshake.** `readFirstLine` leaves the connection
  paused so a frame sent with the handshake is not lost; the SDK's stdio transport adds only a
  `data` listener, which does not start a stream paused on purpose. `serveMcp` resumes its input
  once the transport listens, which on stdin changes nothing.
- **The named pipe's ACL, measured** on Windows 11 with the listener `net` creates, read through
  `NamedPipeClientStream.GetAccessControl()` (`Get-Acl` fails on a pipe with error 87). The
  machine and user names, and the middle of the user's SID, are elided:

  ```
  Owner: <MACHINE>\<user>
  Sddl: O:S-1-5-21-…-1001G:S-1-5-21-…-1001D:(A;;FR;;;WD)(A;;FR;;;AN)(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;S-1-5-21-…-1001)

  IdentityReference            AccessControlType  PipeAccessRights
  Everyone                                 Allow Read, Synchronize
  NT AUTHORITY\ANONYMOUS LOGON             Allow Read, Synchronize
  NT AUTHORITY\SYSTEM                      Allow           2032127
  BUILTIN\Administrators                   Allow           2032127
  <Machine>\<user>                         Allow           2032127
  ```

  Everyone and anonymous logons may open the pipe to read; only the owner, SYSTEM and
  Administrators may write. The window writes nothing on a connection before it has read a
  correct handshake line, and a reader cannot send one, so such a connection gets nothing and is
  cut after 10 seconds. The token stays the gate, as decision 3 says. The record's own ACL is
  `TYTO_HOME`'s: on the machine measured, `C:\Users\<user>\.tyto` inherits SYSTEM, Administrators
  and the owner from the profile, **and carries an explicit read grant to a local
  `CodexSandboxUsers` group** that another tool added. Whatever can read `TYTO_HOME` can reach the
  window; that was already true of the person's plugins and credentials there. Whether a remote
  client can open the pipe over SMB (`PIPE_REJECT_REMOTE_CLIENTS`) was not measured.

- **`--window` is offered.** It is shown by `tyto mcp --help` and in the generated reference,
  and the manual's agents page says how to register it, in both editions.

## Amendment — 2026-11-09, TYTO-566 PR 3

The window tools land. Decisions 6 and 7 stand; four details were settled.

- **The settings are `agentsListen` and `agentsWindowActions`**, not `agents.listen` and
  `agents.windowActions` as decision 6 and the PR 2 amendment wrote them. A built-in setting's
  key is letters and digits (`LOCAL_KEY` in `packages/plugin-api/src/configuration.ts`): a dot is
  how a plugin's key is told apart (`<plugin>.<key>`), so a dotted built-in key would read as a
  plugin's. `agentsListen` applies live: off closes the listener, cuts every agent and removes
  the record; on listens again with the same endpoint and token.
- **A third access, in two kinds.** `MCP_TOOLS` gains `window-read` (`brief_in_front`,
  `selection`: what is on screen, written nowhere) and `window-action` (`open_file`,
  `show_format`). `toolsFor(trust, { window })` offers window reads wherever a window serves,
  restricted folder included, and window actions only to a trusted workspace; the stdio server
  has no window and offers neither. A brief in front whose file is outside the served folders
  answers with its name only, and its selection is refused, by decision 5 of ADR 0179. An
  untitled brief has no path to confine and is answered whole.
- **A proposal for a window action is a box in main**, `showMessageBox` attached to the window,
  naming the full path or the format and the brief; **one at a time**: a request while a box is
  up is declined (`declined: another request is pending`) with no second box. When Tyto is not
  in front, the taskbar flashes and the box waits on the window; it takes no focus from another
  program (read in the code, Windows' foreground rules; not measured on macOS or Linux). The
  in-editor proposal of a text edit is PR 4's.
- **Remote clients reach the pipe.** Measured on Windows 11 with the Server service running: a
  pipe Node's `net` creates accepts a client that comes through the SMB redirector, so libuv does
  not set `PIPE_REJECT_REMOTE_CLIENTS`:

  ```
  local     \\.\pipe\tyto-remote-probe-30368: connected, read "hello\n"
  via localhost \\localhost\pipe\tyto-remote-probe-30368: connected, read "hello\n"
  via 127.0.0.1 \\127.0.0.1\pipe\tyto-remote-probe-30368: connected, read "hello\n"
  server accepted 3 connection(s)
  ```

  Node exposes neither the flag nor the client's computer name, so closing it needs native code;
  the coordinator opens a card for it. Meanwhile the token stays the gate: a remote reader with
  Everyone's read right gets nothing, and a remote caller who may write is the same user, who
  could read `TYTO_HOME` over the administrative share anyway.
