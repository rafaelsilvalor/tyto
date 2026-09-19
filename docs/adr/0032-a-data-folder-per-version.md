# 0032 — Each version of the desktop app gets its own data folder

Status: accepted · 2026-09-19 · TYTO-150 · settles the `name` vs `productName` question TYTO-149 opened

## Context

`apps/desktop` keeps five things beside each other in `app.getPath('userData')` — `logs/`,
`settings.json`, `recent-files.json`, `credentials/` and `layout.json` — each of them a file on
ADR 0009's argument, all of them composed in the composition root from one root Electron hands
back. That root is `<appData>/<app.getName()>`, and `getName()` answers with the **package**
name.

Two things follow, and both were measured rather than argued.

**One folder for every build on a machine.** The packaged portable, the installed build, the
`electron-vite dev` run and every end-to-end suite that does not pass `--user-data-dir` all
resolve to the same folder. So a portable 0.3.0 opens with the layout a dev build left there,
and a tester cannot tell the behaviour of the version they downloaded from the residue of the
one before it. The portable target exists precisely so that a build can sit _beside another
version of itself_ — `electron-builder.yml` says so — and it did not.

**And that folder is not the one anybody was told about.** `apps/desktop/package.json` is named
`@tyto/desktop` while `electron-builder.yml` ships `productName: Tyto`, so the data went to
`%APPDATA%\@tyto\desktop` while `docs/releases/desktop-v0.3.0.md` sent beta testers to
`%APPDATA%\Tyto\logs`. Read out of the shipped artifact rather than off a config file:

```
$ node -e "…read package.json out of release/win-unpacked/resources/app.asar…"
name   = @tyto/desktop
version= 0.3.0
```

On the maintainer's machine `%APPDATA%\Tyto` had by then come into existence and was **empty**,
which is worse than absent: a tester asked for the log folder opens it, finds nothing, and
reports that there is nothing to send.

## Decision

**`<appData>/Tyto/<version>/`.** One product root a person can find and delete whole, one folder
per version inside it.

**The product root is a literal in `src/main/user-data.ts`, not `app.getName()`.** The name a
person is shown belongs to the app, not to the package, and a rename in `package.json` may not
be able to move everybody's settings. `user-data.test.ts` reads `productName` out of
`electron-builder.yml` and fails if the two ever drift, which is the failure that already
happened once.

_Rejected: data beside the `.exe`,_ which electron-builder supports for portable builds through
`PORTABLE_EXECUTABLE_DIR`. It is the purer reading of "portable", and it makes the portable and
the installer behave differently on one machine — a support answer that has to start with
"which of the two did you download?" is a cost paid on every report.

**Every build, not only the portable.** That a new version should not inherit an old layout is
not a property of how the app was delivered.

**The full version, so `0.3.1` is not `0.3.0`.** Right for a beta and wrong for a product: a
person who loses their settings on every patch will say so. That is what the import card is for,
and it is why the import has to land before the auto-updater (TYTO-131) does.

**The path is set at module scope, before `app.whenReady()`.** This is the part that is easy to
get wrong, because the obvious home for it is the top of `start()`, and `start` runs on ready.
Measured with a probe app on win32, twice, with a product root chosen not to collide
case-insensitively with the package name:

```
################ setPath after ready ################
-- left behind in %APPDATA%/probeset (the getName folder) --
Local State
################ setPath before ready ################
-- left behind in %APPDATA%/probeset (the getName folder) --
ls: cannot access '…/AppData/Roaming/probeset': No such file or directory
```

The app's own five paths are composed inside `start` and follow the root either way. Chromium's
do not: by ready it has already opened the folder it was given. A stray `Local State` in a
folder nothing else writes to is exactly the kind of residue this ADR exists to stop.

**`--user-data-dir` is honoured and nothing is set.** Fourteen end-to-end suites launch the app
with that switch pointing at a scratch folder, which is how "restart and the recent files are
still there" means what it says and how one suite cannot reach another's layout. It is also
Chromium's own switch, and a program that ignores it is lying to whoever typed it. The decision
is a pure function returning `undefined` for that case, so it is asserted in a unit test rather
than inferred from a suite that would have gone on passing while quietly sharing one folder.

## Consequences

**Credentials do not travel.** `safeStorage` ciphertext lives under `credentials/`, so it moves
with the folder and a person re-enters what they had until the import card lands. Stated in the
release body rather than discovered.

**Every beta tester on a version before this one keeps their data where it is**, in
`%APPDATA%\@tyto\desktop`, and nothing here reads it. `docs/releases/desktop-v0.3.0.md` is
therefore corrected to the folder the shipped 0.3.0 really writes — the release body describes
an artifact people already hold, and rewriting it to this ADR's path would make it wrong for
every machine it was written for.

**The auto-updater becomes blocked on the import card, not on this one.** An update that
silently moves somebody into an empty folder is worse than no update at all.

**TYTO-149's open question is closed by this ADR** and what remains of that card is the log
folder that does not exist until something is written to it, which this changes nothing about.
