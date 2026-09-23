# 0036 — A new version offers the previous one's settings, once

Status: accepted · 2026-09-23 · TYTO-151 · amends the credentials consequence of ADR 0032

## Context

ADR 0032 gave every version of the desktop app its own data folder,
`<appData>/Tyto/<version>/`, so a tester could tell the build they downloaded from the residue
of the one before it. The price was named in that ADR: a person who updates from 0.3.3 to 0.3.4
opens an app that has forgotten their templates folder, where they put the panels and what they
had open. The auto-updater (TYTO-131) waits on this, because an update that silently moves
somebody into an empty folder is worse than no update.

A version folder holds five things: `settings.json`, `layout.json`, `recent-files.json`,
`credentials/` and `logs/`. By the time the app's own code runs, Chromium has also written its
own files there (`Local State` and others), so a new version's folder is never literally empty.

## Decision

**On the first run of a version, the highest older version's records are offered, once, by
name** (`apps/desktop/src/main/previous-version.ts`). A native box, before the window opens and
before the settings are read, because the templates folder decides which templates the registry
is built from:

> Bring your settings from version 0.3.3?
> The templates folder, where the panels were and the recent files. Version 0.3.3 keeps its
> own copy either way, and this question will not come back.
> [Bring them] [Start fresh]

**When.** The new folder has none of the app's own records — no `settings.json`, `layout.json`,
`recent-files.json`, `credentials/` or `import.json` — and an older version folder exists with at
least one of them. Chromium's files and `logs/` do not count: the first is always there and the
second is written by `start` before the question. An older folder that left nothing to bring is
not offered; a question whose _yes_ copies nothing teaches a person to click through the next one.

**Which version.** The highest older one by semver precedence (prereleases before their release,
numeric identifiers as numbers), not the most recently touched. A person who opened 0.3.0
yesterday to check something is still a 0.3.3 user. Folder names that are not versions are
ignored. A higher version is never offered to a lower one.

**Only a folder this app chose.** When `--user-data-dir` was passed, nothing is offered: that is
a suite's scratch folder (ADR 0032), it has no sibling versions, and a native box on its first run
would wait for a person who is not there. **Nor under `TYTO_HEADLESS=1`**, the switch the
end-to-end suites use to run without showing a window: four suites launch without
`--user-data-dir`, so they run in the real `<appData>/Tyto/<version>`, and on the maintainer's
machine — which has 0.3.0 to 0.3.3 beside 0.3.4 — the box opened with no window and all four
timed out waiting for it. Nothing is recorded in that case, so the next real launch still asks.

**Copy, never move.** The older version stays installed and must find its folder the way it left
it. Records are copied byte for byte after checking they parse as JSON; each store already
reconciles what it reads against the build reading it (`layoutFrom` drops a panel this build no
longer has), so re-serialising here would be a second, weaker copy of that rule. Writes use the
`wx` flag, so anything written in the new folder in the meantime wins.

**`logs/` never travels.** A log is that build's record of its own failures.

**What the answer means.** Either answer writes `import.json` into the new folder —
`{ "from": "0.3.3", "answer": "imported" | "declined", "credentials": false }` — and that file is
what makes the offer once. Escape and closing the box are _Start fresh_, and are recorded the
same way: the card asks for "no" to mean never again, and a box that came back after being
dismissed would be the nag this is trying not to be. If `import.json` cannot be written the only
cost is being asked again on the next launch, which is logged.

**A broken older folder does not stop the new one** (ADR 0013's shape). A record that cannot be
read, is not JSON, or cannot be written is a `W_IMPORT_SKIPPED` warning on the ok branch beside
the records that did come across, and each one is written to the log. If the question itself
fails, the failure is logged and the version opens clean. `offerPreviousVersion` never throws.

### Credentials: brought only when the person ticks a separate box

**Stored credentials are copied only when the person ticks a checkbox of their own, unticked by
default, and shown only when the older version had stored any:** _Also bring the saved sign-ins._
On _Start fresh_ nothing travels, whatever the box says.

Copying works, technically: `safeStorage` ciphertext is sealed with a key held by the OS user
(DPAPI, Keychain, the session keyring), not by the folder, so a copied file decrypts in the new
version for the same person on the same machine. A unit test copies one and reads it back through
`createCredentials`.

It is still a different act from copying a panel width. A secret leaving one folder for another on
the app's initiative is the kind of thing a person should decide and not discover, so it gets its
own sentence and its own tick. Unticked, because the cost of a wrong default is lopsided: an
unticked box costs a person typing a token again, and a ticked one copies secrets nobody chose to
copy.

_Rejected: never copy credentials._ Simpler, and it makes every update a re-sign-in, which is what
ADR 0032 already imposed and what this card exists to end.

_Rejected: copy them with everything else._ One click fewer, and it is the app deciding where
secrets go.

## Consequences

**ADR 0032's "credentials do not travel" is now "credentials travel when the person ticks the
box".** The rest of ADR 0032 stands.

**What is proven where.** Which version is offered, what is copied, that the older folder is
byte-for-byte unchanged, that _no_ is recorded and not asked again, what a broken folder produces
and both credential cases are asserted against real folders in `previous-version.test.ts`. The
native box itself — its wording, its checkbox, Escape — is not covered by an automated test: the
end-to-end suites launch with `--user-data-dir` or `TYTO_HEADLESS=1`, which by the rules above
means no offer, and a native message box is not something Playwright can answer.

**Beta testers on versions before ADR 0032** keep their data in `%APPDATA%\@tyto\desktop`, and
this does not read it. That folder is not named by version, so there is nothing to compare it to;
reading it would be a second import path for a population of a handful of testers.

**The detail line names all three records** even when the older folder had only some of them. It
is one sentence in the catalogue rather than one per combination, and a record that was not there
simply does not arrive.
