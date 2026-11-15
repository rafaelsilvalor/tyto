# 0194 — The CLI signs in through the browser and keeps it in the system keychain

Status: accepted · 2026-11-12 · TYTO-683 · amends ADR 0134 and ADR 0174 decision 5 · builds on
ADR 0131, ADR 0159, ADR 0174, ADR 0191 and ADR 0192

## Context

ADR 0174 gave a plugin a person's own sign-in through the host, and the desktop runs it: PKCE on
a loopback port, the refresh token in `safeStorage`, the access token in main's memory. Decision 5
left the CLI out: it had no window to sign in from and no store to keep a token in, so it answers
`E_SIGNIN_UNAVAILABLE`, and a recipe that reads a person's spreadsheet from a terminal still
needs a service account (TYTO-677). The maintainer asked on 2026-11-11 to retire the service
account, which needs the terminal to sign in.

The flow is the easy part: TYTO-683's first pull request moved it to `@tyto/plugin-api` and
`@tyto/io`, so a second host composes it. The hard part is where a terminal keeps a refresh
token. ADR 0134 made the CLI read-only for secrets, its credentials environment variables, and
Electron's `safeStorage` does not exist outside Electron. Three ways were weighed; what was measured
on the maintainer's Windows 11 machine on 2026-11-12 is marked as such:

- **Per-OS commands.** DPAPI through `powershell.exe` round-trips, at 536 to 830 ms a call
  (measured). macOS's `security -w <value>` puts the secret in the process list (read). Three code
  paths, each provable only on its own system.
- **An encrypted file under `TYTO_HOME`.** With its key beside it, it protects against nothing a
  copy of the folder does not also carry; with a passphrase, an unattended `every` recipe cannot
  run.
- **A native module over the OS keychain**, `@napi-rs/keyring`: Credential Manager on Windows,
  Keychain on macOS, the Secret Service on Linux. Prebuilt for Windows, macOS and Linux (glibc and
  musl), so unlike `node-pty` (ADR 0164) nothing compiles on Linux. Measured in a namespace of its
  own, then deleted: a round trip in 4 to 6 ms; `setPassword` stores UTF-16 and refuses 1,281
  characters; `setSecret` stores bytes and holds exactly **2,560 bytes**, refusing 2,561 by name.

## Decision

1. **`tyto signin <plugin> [id]` signs in through the system browser** with the flow ADR 0174
   decision 8 describes, shared from `@tyto/plugin-api`. The id may be left out when the plugin
   declares one sign-in. The command prints the authorize address too, for a person whose browser
   did not open. **Only this command opens a browser**: ADR 0174 decision 6 holds, and a plugin's
   call never does. `tyto signout <plugin> [id]` forgets it; with an id typed whole it needs no
   installed manifest, so a sign-in is forgotten after its plugin was removed.
2. **The client a manifest leaves out (ADR 0192) is typed at a prompt**: `tyto signin <plugin>
[id] --client` asks for the client ID and, without echoing it, the optional secret. Never on
   the command line, where a shell's history keeps it. `tyto signout … --client` forgets it. A
   flag rather than a `tyto signin client` subcommand, so a plugin named `client` is not shadowed.
3. **The refresh token and the client live in the OS keychain through `@napi-rs/keyring`**,
   pinned at `2.1.2` in `apps/cli`, under the service name `Tyto CLI` and the accounts the desktop
   uses: `signin:<plugin>:<id>` and `signin-client:<plugin>:<id>`. Values are stored as UTF-8
   bytes with `setSecret`. **The ceiling is 2,560 bytes on every system**, Windows' limit, so a
   sign-in that is kept on one system is kept on all. The per-system limits: Windows 2,560 bytes
   through `setSecret` (measured: 2,560 stored, 2,561 refused); macOS and Linux not measured. A
   value over the ceiling is refused with a message that names both numbers, before the keychain
   is asked, and is never truncated. A stored sign-in measured 86 bytes. A client at ADR 0192's
   limit, two values of 512 characters, is about 1,060 bytes of JSON when the characters are
   ASCII, as client ids and secrets are, and fits; ADR 0192 counts characters, so a client of
   512 three-byte characters each would not, and is refused by name. The module is loaded on the first keychain read, so a
   command that never signs in never loads it. The access token lives in the process's memory, as
   in the desktop: a run refreshes once and every plugin of that run shares the token.
4. **No plaintext fallback.** A keychain that refuses — a Linux session with no Secret Service,
   which a headless WSL answered with "The name is not activatable" (measured) — is an error the
   command prints, and a plugin's call in that terminal fails with the keychain's reason. Nothing
   is ever written to a file instead.
5. **The CLI's sign-ins are its own.** The terminal never opens the desktop's `safeStorage` files,
   and the desktop never reads the CLI's keychain entries. Reading the desktop's store would mean
   reimplementing Chromium's own encryption per system and choosing a version folder; a person
   signs in once per host.
6. **The window's command panel refuses `signin` and `signout`** (ADR 0159 decision 2): the
   window signs in from its plugins screen and composes no keychain for the panel.
7. **`E_SIGNIN_REQUIRED` names how to sign in on the host that answers it**, through the optional
   `HostCapabilities.describeSignin`: the CLI says `run tyto signin <plugin> <id>`, and a host
   without it, the desktop, says to sign in from the plugins screen, as before.

**Threat model, in two lines.** The keychain protects a refresh token from a copy of the disk or a
backup and from other users of the machine, as the desktop's `safeStorage` does. Like it, it does
not protect from a program running as the same user, which can ask the keychain as Tyto does.

## Consequences

- `tyto signin google` then `tyto recipe run` reads a person's spreadsheet as that person, with
  no service account stored. Removing TYTO-677's fallback in the Google plugin is a later card.
- A terminal with no keychain — a CI runner, a server without a desktop session — still cannot
  sign in, and a recipe there needs another credential. That is not decided here.
- `@napi-rs/keyring` is a native dependency of `apps/cli` only; the desktop never loads it. Its
  binary is chosen per platform by npm's `os`/`cpu`/`libc` fields, and no install script runs.
- `tyto plugin remove` says that `tyto signin`'s sign-ins stay in the system keychain and that
  `tyto signout` forgets one, beside what it already said of the desktop's.

### Amends ADR 0134

"The CLI is read-only" stays true of a plugin's own credentials: they are still environment
variables, and `host.credentials.set` there is still `E_CREDENTIAL_READ_ONLY`. It no longer holds
for sign-ins: the CLI keeps `signin:` and `signin-client:` entries, which only the host reads.

### Amends ADR 0174 decision 5

The CLI composes the `signinAccessToken` port wherever its app gave it a keychain, which
`apps/cli` always does; `E_SIGNIN_UNAVAILABLE` remains the answer of a command line composed
without one, a test's or the window's panel's.

## Amendment — no service account, and no headless sign-in (TYTO-701, 2026-11-14)

**Tyto's Google verbs act only as a signed-in person.** The maintainer chose on 2026-11-14 that
the app always acts as the person, because the decisions are theirs, and that the service
account goes. tyto-plugin-google#15 removed it: the fallback on `E_SIGNIN_UNAVAILABLE`, the key
in `TYTO_PLUGIN_GOOGLE_SERVICE_ACCOUNT`, and the `credentials:service-account` and
`net:oauth2.googleapis.com` permissions. A terminal with no keychain now answers
`E_GOOGLE_SIGNIN`, saying it cannot sign in, with no credential read and no token request.

The second consequence above is closed by not adding a credential: a recipe that reads a
person's files runs in the window or in a terminal with a keychain, and nowhere else. A refresh
token injected by a CI secret was weighed and refused, because it is the person's whole Drive in
a secret store. Reopening it needs a new ADR.
