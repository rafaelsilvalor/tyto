# 0189 — On Windows the window serves agents on loopback TCP, not a named pipe

Status: accepted · 2026-11-10 · TYTO-653 · changes ADR 0180 decision 2 on Windows · builds on
ADR 0180 decision 3 and ADR 0164

## Context

ADR 0180 put the window's endpoint for agents on a named pipe on Windows,
`\\.\pipe\tyto-<user>-<pid>`. Its PR 3 amendment measured that the pipe Node's `net` creates
accepts clients that come through the SMB redirector: `\\localhost\pipe\…` and
`\\127.0.0.1\pipe\…` connected and read. A local endpoint should not be reachable from the
network, even with a token in front of it. TYTO-653 asked for that to be closed, and listed three
ways: native code that creates the pipe with `PIPE_REJECT_REMOTE_CLIENTS`; a check of
`GetNamedPipeClientComputerName` on every connection; or a different local transport.

### What was measured

On 2026-11-10, on Windows 11 with the Server service (LanmanServer) running. The probes create
a pipe, connect to it by the three paths, and report.

- **The flag works, and so would the name check.** A server made with `CreateNamedPipeW`
  directly (C# P/Invoke) and `PIPE_REJECT_REMOTE_CLIENTS` accepted `\\.\pipe\…` and refused both
  SMB paths with `EPERM`. Without the flag, `GetNamedPipeClientComputerName` answered `[::1]` and
  `127.0.0.1` for the SMB clients, and failed with error 229 for the local one. So, to Windows,
  SMB loopback is a remote client.
- **Neither is reachable from Node.** Both need the server-side `HANDLE` of the pipe instance.
  Node never exposes it for a `net` server (`_handle.fd` is -1 on Windows). Node cannot adopt a
  `HANDLE` made outside libuv either: `Pipe.open` takes a file descriptor of Node's own C
  runtime. Using the flag would mean serving the whole pipe from native code: an addon with its
  own I/O completion port loop, and Windows prebuilt binaries we would build and ship. ADR 0164
  allows prebuilt binaries only, and no maintained package does this. An FFI module such as
  koffi would run each blocking `ReadFile` on libuv's thread pool, which the file system shares.
- **Rewriting the pipe's DACL does not stop SMB loopback.** We opened Node's own pipe with
  `WRITE_DAC` and called `SetSecurityInfo`. The DACL is pipe-wide: later instances carried it.
  Two DACLs were tried, and with each the SMB paths still connected and read:
  `D:P(D;;GA;;;NU)(A;;GA;;;SY)(A;;GA;;;<user>)`, which denies NETWORK, and one that allows only
  SYSTEM and the logon session's SID. A machine elsewhere on the network would carry NETWORK
  in its token and might be refused, but that could not be measured here. The rewrite needs
  native code or a PowerShell child at every start anyway.

## Decision

1. **On Windows the window listens on loopback TCP: `127.0.0.1`, on a port the system picks.**
   The record's `endpoint` is `tcp://127.0.0.1:<port>`, written once the window listens. macOS
   and Linux keep the Unix socket of ADR 0180 decision 2, mode 0600 in a 0700 folder. The
   contract stays in `@tyto/command-line`: `listenTargetFor` says where to listen,
   `loopbackEndpoint` names the port, and `connectTargetOf` reads it back. No dependency is
   added.
2. **A relay connects to nothing but loopback.** A `tcp://` endpoint whose host is not exactly
   `127.0.0.1`, or whose port is not 1 to 65535, is refused before any connection is made. The
   relay skips that record as one with nobody listening (ADR 0180, TYTO-656), because the
   handshake would otherwise carry the token off the machine. Any other endpoint is a socket
   path, so a pipe written by a window older than this decision still connects.
3. **On TCP the token is the only gate**, so the record holding it is kept to its owner. Before
   it listens, the window runs `icacls` on `TYTO_HOME/windows`: inheritance is removed, and
   SYSTEM and the person's account are granted, inheritable. Each record is created there
   afterwards, so it carries those two entries from the start. Measured on the maintainer's
   machine before this decision, a record inherited `TYTO_HOME`'s ACL, which includes a read
   grant to a local `CodexSandboxUsers` group that another tool added. A window that cannot
   restrict the folder does not listen.
4. **The handshake is unchanged** (ADR 0180 decision 3): a first line with the token, compared in
   constant time. Anything else, an HTTP request line included, gets
   `{"tyto":"window","ok":false}` and the connection is closed, with no pid, no folder and no
   frame.
5. **Turning `agentsListen` off and on again keeps the token**, as ADR 0180's PR 3 amendment
   says, but on Windows the port is whichever the system gives that time. The record is written
   again either way.

### Who can connect, and what each can do

| Who                                                                       | Named pipe (ADR 0180)                                                                       | Loopback TCP (this ADR)                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The same person, local                                                    | Connects; with the token, drives the window                                                 | The same                                                                                                                                      |
| Another local account, or a sandboxed process outside the owner's account | Connects with Everyone's read right; cannot write a handshake, gets nothing, cut after 10 s | **Connects and can write a handshake.** Without the token it gets the refusal line and is closed. The token is unreadable to it (decision 3)  |
| A browser on this machine                                                 | Cannot open a pipe                                                                          | Can reach the port, over HTTP or WebSocket only. Its first line is a request line, so it is refused. Pages can probe whether the port is open |
| A host on the LAN                                                         | Through SMB, as a user the machine authenticates: Everyone's read right, gets nothing       | Refused: nothing listens on the LAN address (measured, `ECONNREFUSED`)                                                                        |
| SMB, `\\localhost\pipe\…` or `\\127.0.0.1\pipe\…`                         | Connects and reads                                                                          | No pipe exists (`ENOENT`)                                                                                                                     |

The trade is deliberate. The network path is gone. In exchange, another account on the same
machine can now send bytes where before it could only read, and the 256-bit token, kept to the
owner by decision 3, is what stops it. A sandbox meant to cut a process off from the person's
window must also cut it off from loopback. Windows does this for AppContainer processes by
default.

## Consequences

- `tyto mcp --window` and the relay a Tyto terminal runs connect by the record, so agents
  register the same command as before.
- An older relay reads `tcp://…` as a pipe's name, gets `ENOENT`, and skips the record, saying
  so on stderr (TYTO-656). The relay ships inside the app (ADR 0181), so the two versions differ
  only when a person points an agent at a `tyto` they installed and pinned by hand.
- Each start on Windows runs `icacls.exe` from `System32` once.
- Linux CI cannot run the Windows half. The loopback listener, the LAN refusal and the record's
  ACL are tested on Windows only: `agent-endpoint.test.ts` runs them when `process.platform` is
  `win32`. The relay over a loopback port is tested on every platform.
- Should Node or libuv ever expose `PIPE_REJECT_REMOTE_CLIENTS`, a pipe that refuses remote
  clients and grants the owner alone would be stricter than loopback TCP, and is worth a new
  ADR then.
