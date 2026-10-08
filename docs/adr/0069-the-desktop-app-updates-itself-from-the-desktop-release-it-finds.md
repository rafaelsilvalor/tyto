# 0069 — The desktop app updates itself from the desktop release it finds itself

Status: accepted · 2026-10-08 · TYTO-131 · builds on ADR 0032, ADR 0036 and ADR 0039

## Context

Once the beta is on other people's machines, every fix costs each tester a manual download
unless the app can update itself. `docs/git-workflow.md` and `electron-builder.yml` had said
since the bootstrap that this would be `electron-updater` reading the GitHub releases, and the
repository being public means it needs no token and no server.

**The library's default way of finding the release is wrong for this repository, measured.**
electron-updater's `github` provider asks GitHub for the repository's _Latest_ release
(`GitHubProvider.getLatestTagName` → `/releases/latest`) and reads `latest.yml` out of it. This
repository publishes a release per `@tyto/*` package through Changesets, beside the desktop ones:

```
$ gh api repos/rafaelsilvalor/tyto/releases --paginate -q '.[]|.tag_name+" "+.published_at' | head -3
desktop-v0.6.0 2026-10-06T23:00:18Z
@tyto/templates@1.0.0 2026-10-06T22:42:20Z
@tyto/template-lang@0.7.0 2026-10-06T22:42:17Z
```

13 package releases beside 1 desktop release, and `desktop-v0.6.0` is Latest only because it was
published 18 minutes after the packages. The next Version Packages merge makes a package release
Latest, and every installed app would then ask `@tyto/core@x/latest.yml` for an update and get a 404. The Atom feed is no way round it: it carries the ten newest releases, and that one merge
created thirteen.

**And not every platform can install.** What electron-updater does per platform, read in
`electron-updater` 6.8.9 and `app-builder-lib` 26.15.3:

- **Windows, NSIS**: `NsisUpdater` runs the downloaded Setup silently. With no certificate
  `app-update.yml` has no `publisherName`, and `NsisUpdater.verifySignature` returns early when
  it has none: the download is held to the release by the sha512 in `latest.yml`, fetched over
  HTTPS from GitHub, and by nothing else.
- **Windows, portable**: `app-update.yml` is written into the shared `win-unpacked` whenever
  `nsis` is a target (`PublishManager`, `isSuitableWindowsTarget`), so the portable carries it
  too, and `NsisUpdater` would run the _Setup_ over a portable copy — turning something carried
  on a stick into an installed program.
- **Linux, AppImage**: `AppImageUpdater` replaces the file `APPIMAGE` names, in place.
- **macOS**: `MacUpdater` hands the download to Squirrel.Mac, which installs only into a signed
  app. Tyto has no certificate. This one is read, not measured: there is no Mac here.

## Decision

**The app finds the newest desktop release itself, and hands electron-updater that one
release's folder** (`src/main/update-feed.ts`). One unauthenticated call per launch to
`GET /repos/rafaelsilvalor/tyto/releases?per_page=100` (60 an hour per address), then:

- drafts and prereleases are skipped;
- the newest is chosen by semver, never by date, so a `0.6.1` fix published after `0.7.0` moves
  nobody back;
- a tag that is not `desktop-v<semver>` is absent, not an error — the listing is the whole
  repository's;
- only a body that is not a list at all (GitHub's rate-limit answer is an object) is a failure.

If that release is newer than the running version, electron-updater's **`generic` provider** is
pointed at `https://github.com/rafaelsilvalor/tyto/releases/download/<tag>/`, which is where
`latest.yml`, `latest-linux.yml` and the installers already are. Nothing about how `desktop.yml`
publishes changes.

**Per platform:**

| Copy                    | Gets              | Why                                            |
| ----------------------- | ----------------- | ---------------------------------------------- |
| Windows, installed      | updates itself    | `NsisUpdater`; sha512-checked, unsigned        |
| Windows, portable       | a "download" link | the Setup must not replace a portable copy     |
| Linux, AppImage         | updates itself    | `AppImageUpdater`; measured end to end (below) |
| Linux, anything else    | a "download" link | no `APPIMAGE` file to replace                  |
| macOS                   | a "download" link | Squirrel.Mac needs a signed app                |
| not packaged (dev, e2e) | nothing           | `app.isPackaged` is false                      |

**On a link-only copy — the maintainer's decision, 2026-10-08** — the footer shows _Version X
available — Download_, which opens that version's release page. The window never hands main a
URL: main holds the one it found.

**So there is still no macOS `zip`.** electron-updater wants one only to install, and macOS does
not install until somebody has a certificate. The comment in `electron-builder.yml` now says that
signing is what turns it on, rather than that there is no updater.

**When — the maintainer's decision, 2026-10-08.** Checked once on launch, downloaded in the
background, **installed when the app quits** — never in the middle of a session. The footer shows
_Version X is ready — Restart to update_; clicking it is a quit like any other, and a person who
ignores it gets the new version the next time they quit. Asking first with a box was the
alternative; a box that interrupts somebody typing to ask about something that can wait until
they leave is the nag this app avoids elsewhere (ADR 0036), and the footer already holds the
version a tester is asked for first.

**Nothing installs before the quit guard has said yes.** electron-updater's own `quitAndInstall`
starts the installer _and then_ quits (`BaseUpdater.quitAndInstall`), and its install-on-quit
listens on `quit` with no say over it. Both are bypassed: install-on-quit is switched off, the
restart button calls `app.quit()` — the same request Cmd+Q makes, which goes through
`before-quit` and the window's unsaved-tabs question (ADR 0039) — and the install runs from one
listener on Electron's `quit` event, which fires only once nothing prevented the quit. A person
who chooses to stay for an unsaved tab keeps the version they are typing in. A quit with a
non-zero exit code installs nothing.

**No network, or a broken feed: the app opens normally and logs one line**,
`Update check failed: <reason>`, whatever failed and however many times electron-updater reports
it. The check is not awaited by anything the window needs.

**Data folders.** An updated app starting for the first time is a new version's first launch, so
ADR 0032 gives it its own folder and ADR 0036 offers the previous version's settings, once, by
name — exactly as for a version installed by hand. Nothing new is needed and nothing is skipped:
the import box comes before the window, so a person who restarted to update sees it first.

**Suites never reach GitHub.** A launch with `--user-data-dir` or `TYTO_HEADLESS=1` does not check
the real feed: a packaged suite that downloaded a real release because one happened to be newer
would be measuring the network.

**The end-to-end proof is local.** `e2e/update.package.test.ts` packages `9.0.0` and `9.0.1` from
the same `out/` on the Linux runner and serves the newer one from a folder on loopback. The older
build learns where to look from `tytoUpdateFeed`, a field electron-builder's `extraMetadata`
writes into the packaged `package.json` of those two builds and no other — and which the app
accepts only as a loopback `http` URL, so even an escaped test build cannot be pointed at a
server somebody else runs. `packaged.package.test.ts` reads the ordinary package and asserts the
field is absent and the GitHub URL is in the bundle. No release is published to prove any of it.

**`electron-updater` joins the stack as a runtime dependency, without an ADR of its own.** It is
electron-builder's own updater, from the same repository and release train, and reading the feed
electron-builder writes is what it is for; the stack rule in `CLAUDE.md` is about swapping a tool,
and this adds the other half of one already chosen. It is bundled into main like everything else
(`electron.vite.config.ts`), in a chunk loaded only on a copy that installs.

## Consequences

- `0.6.0` contains no updater. Its users download the first version that has one by hand, once.
- A tester who wants to stay on a version, or go back, downloads it from the release list; the
  app never installs an older version.
- Windows updates are unsigned: what stands between the release and the installer is HTTPS and a
  sha512. Signing the app (`CSC_LINK`, `docs/git-workflow.md`) also turns on electron-updater's
  publisher check, and is what would let macOS install.
- The Windows install path is held by unit tests and by reading electron-updater's source, not
  by a run: Smart App Control refuses a freshly packaged `Tyto.exe` on the maintainer's machine.
- If Changesets ever stops creating package releases, `/releases/latest` would work again; the
  lookup costs one request and does not need to change back.
