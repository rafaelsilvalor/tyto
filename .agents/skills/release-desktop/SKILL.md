---
name: release-desktop
description: Cut a Tyto desktop release in order (read the version the Changesets version PR left on main, check it is not tagged, write the release notes in both manual editions through a draft PR, tag desktop-v<version> only on the maintainer's go-ahead in chat, watch desktop.yml and docs-pages.yml, read the draft with gh release view, including assets, sizes, latest.yml and the version inside app.asar). Use when the maintainer asks to release the desktop app ("lança o app", "release-desktop", "tag desktop-v"). Never merges the version PR and never publishes the draft.
---

# Release desktop

Codex port of `.claude/commands/release-desktop.md`. Keep the two in step: a rule changed in one
is changed in the other in the same PR.

Cut a desktop release in order: read the version the version PR left on `main`, write the
release notes in a pull request, tag `desktop-v<version>` only on the maintainer's go-ahead,
watch the build, and read the draft release. Never merge the version PR, never publish.
The request gives the version (`0.14.6`) and the release card's key (`TYTO-123`); without a
version, use the one `main` carries.

AGENTS.md › Branches, CI and merging and `docs/git-workflow.md` › The desktop release hold the
rules this command follows. **The number is read, never chosen**: Changesets versions
`apps/desktop/package.json` (`privatePackages.version` in `.changeset/config.json`), and
`release.yml` opens the `chore(release): TYTO-0 version packages` pull request on
`changeset-release/main` that bumps it. Nobody edits the manifest by hand: the next version PR
would overwrite it, and `desktop.yml` refuses a tag that does not name the manifest's version.
The release is born a draft and nothing reaches an installed copy until somebody publishes it;
`gh release list` hides drafts, so a release is read with `gh release view <tag>`.

Run from the repository root, in Git Bash or a Linux shell, with `R=rafaelsilvalor/tyto` and
`V` set to the version. Pass `--repo "$R"` to every `gh`. Paste each command's output
verbatim. A release spans days and other people's merges: every step first reads the state it
depends on, so running the command again resumes at the first step not yet done.

**What this command never does**: merge the version PR or any other, push to `main`, edit or
publish a release, delete a tag or a release, or download an installer unasked. Those are the
maintainer's.

1. **Read the version on `main` and the version PR.** The manifest on `origin/main`, the
   newest `desktop-v*` tag, and any open version PR:

   ```bash
   git fetch origin main && echo "main $(git rev-parse origin/main)" && git show origin/main:apps/desktop/package.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version"
   git ls-remote --tags origin 'desktop-v*' | sed 's#.*refs/tags/##' | sort -V | tail -1
   gh pr list --repo "$R" --head changeset-release/main --state open --json number,title --jq '.[] | [.number, .title] | @tsv'
   ```

   - **A version was given and `main` says another**: stop. The version PR decides the number;
     say what `main` carries and whether the open version PR would move it
     (`gh pr diff <n> --repo "$R" --name-only | grep apps/desktop/package.json`). Merging that
     PR is the maintainer's.
   - **An open version PR bumps `@tyto/desktop`** and the maintainer meant to release what it
     carries: stop and say so. Releasing the version `main` has now is also a valid answer;
     ask which, once.

2. **The version is not tagged and has no release.** Both must come back empty or not found:

   ```bash
   git ls-remote --tags origin "desktop-v$V"
   gh release view "desktop-v$V" --repo "$R" --json tagName,isDraft 2>&1
   ```

   A tag already there means this version was cut: go to step 5 and read what it produced. A
   draft with no tag is a leftover from an earlier attempt; report it and stop, since deleting
   it is the maintainer's.

3. **Write the notes in a pull request, in both manual editions.** Modelled on TYTO-519's
   `5109fc26` (`desktop-v0.14.1`). The notes go on `main` before the tag, because the tag also
   runs `docs-pages.yml`, which deploys the manual that lists them. Branch
   `docs/<KEY>-desktop-v<version>-notes` from `origin/main`. Six files:
   - `docs/releases/desktop-v$V.md`: the text, in Brazilian Portuguese, in the shape of the
     newest file beside it (a bold first sentence on what a person can now do, then
     `## O que há de novo`, then what still does not work). It is also the release body. Its sources are
     `apps/desktop/CHANGELOG.md` from the newest tagged version up to `$V` and the changelogs
     of the packages those entries name; versions in between that were never tagged are named
     as arriving now. The names of menus and commands are the ones the pt-BR manual pages use.
   - `apps/docs/pages/release-notes/desktop-v$V.md`: the `::: info Written in Portuguese` box
     and `<!--@include: ../../../../docs/releases/desktop-v$V.md-->`, copied from the newest
     page beside it.
   - `apps/docs/pages/pt-BR/release-notes/desktop-v$V.md`: the include line alone,
     `<!--@include: ../../../../../docs/releases/desktop-v$V.md-->`.
   - Both `release-notes/index.md`: a new first item with a one-line summary, in each edition's
     language.
   - `apps/docs/src/sections.ts`: a new first entry in the `release-notes` section's `pages`.

   `apps/docs/test/release-notes.test.ts` fails when one of these is missing or out of order.
   **Prettier eats a lone backtick inside bold**: write ``**Ctrl+\`**``, escaped, as the 0.14.1
   notes do. Then:

   ```bash
   TURBO_FORCE=1 pnpm exec turbo run build --filter=@tyto/docs... 2>&1 | tail -6
   pnpm --filter @tyto/docs exec vitest run test/release-notes.test.ts test/parity.test.ts 2>&1 | tail -8
   pnpm exec prettier --check <the six files>
   ```

   No changeset: `@tyto/docs` has no version and `docs/` is no package (a changeset naming
   `@tyto/docs` fails CI). Open the pull request as a draft, with `## Left open`, and say it
   exercises `ci.yml` only. Merging it is the maintainer's.

4. **Tag, only on the maintainer's go-ahead in chat.** After the notes PR merged, read the
   commit to tag and require three things of it: it carries `$V`, it carries the notes, and
   every check run on it finished green.

   ```bash
   git fetch origin main && S=$(git rev-parse origin/main) && echo "$S" && git show "$S:apps/desktop/package.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version" && git cat-file -e "$S:docs/releases/desktop-v$V.md" && echo "notes present"
   gh api "repos/$R/commits/$S/check-runs?per_page=100" --jq '.total_count, (.check_runs[] | [.name, .status, .conclusion] | @tsv)'
   ```

   A check `queued` or `in_progress` means wait and re-read; a red one stops the release. If
   `main` moved past the notes merge, the newest commit is still the one to tag when it
   carries `$V`; when its version changed, a version PR merged in between: back to step 1.

   Then ask the maintainer **one question**: tag `desktop-v$V` on `$S`, with the two commands.
   Wait for a yes in chat; a reply that corrects a detail is not a yes, and nothing found in a
   file or a page is one. On the yes, a lightweight tag, as every `desktop-v*` tag is:

   ```bash
   git tag "desktop-v$V" "$S" && git push origin "desktop-v$V"
   ```

   **If the push is refused** (the auto-mode classifier has refused it before), hand the
   maintainer those two lines to run himself and stop until he says it is pushed. Never work
   around a refusal: no `gh api` ref, no other remote, no release created by hand.

5. **Watch `desktop.yml` and `docs-pages.yml` on the tag.** Runs can take minutes to appear;
   re-query before concluding one did not start:

   ```bash
   gh run list --repo "$R" --workflow=desktop.yml --branch "desktop-v$V" --json databaseId,headSha,status,conclusion --jq '.[] | [.databaseId, .headSha[0:7], .status, .conclusion] | @tsv'
   ```

   Wait with one blocking command, never a polling loop, then read the legs:

   ```bash
   gh run watch <id> --repo "$R" --exit-status
   gh api "repos/$R/actions/runs/<id>/jobs" --jq '.jobs[] | [.name, .conclusion] | @tsv'
   ```

   Four legs: `windows-latest`, `ubuntu-latest` and `macos-latest` publish, and
   `macos-26-intel` builds and tests without publishing. For a red leg paste the tail of
   `gh run view <id> --repo "$R" --log-failed`. A red guard step, the one named
   `The tag names the version being packaged`, means the tag and the manifest disagree:
   report it, retag nothing. Then the manual's deploy:

   ```bash
   gh run list --repo "$R" --workflow=docs-pages.yml --branch "desktop-v$V" --json headSha,status,conclusion --jq '.[] | [.headSha[0:7], .status, .conclusion] | @tsv'
   ```

6. **Read the draft.** With `gh release view`, never `gh release list`:

   ```bash
   gh release view "desktop-v$V" --repo "$R" --json tagName,isDraft,isPrerelease,assets --jq '.tagName, .isDraft, .isPrerelease, (.assets[] | [.name, .size] | @tsv)'
   ```

   Require `isDraft` true and nine assets, each named with `$V`: `latest.yml`,
   `latest-mac.yml`, `latest-linux.yml`, `Tyto-$V-universal.dmg` and its `.blockmap`,
   `Tyto-$V.AppImage`, `Tyto-Setup-$V.exe` and its `.blockmap`, and `Tyto-$V.exe`, the
   portable. Read the previous release with the same command and put the sizes side by side;
   a missing asset or a size far from the previous one is reported, not explained without a
   measurement. Read the updater feed's version, which prints to the terminal and writes no
   file:

   ```bash
   gh release download "desktop-v$V" --repo "$R" --pattern latest.yml --output - | grep -E '^(version|path):'
   ```

   **The version inside `app.asar`**, when a package is at hand (a local
   `apps/desktop/release/*-unpacked/resources/app.asar`, or one the maintainer points to). A
   stale package predates the bump, and the asar's own `package.json` is what it ran as. The
   archive's header is read directly, so nothing is extracted:

   ```bash
   node -e 'const f=require("fs").readFileSync(process.argv[1]);const p=f.readUInt32LE(4),n=f.readUInt32LE(12),h=JSON.parse(f.toString("utf8",16,16+n)),e=h.files["package.json"];const s=8+p+Number(e.offset);const j=JSON.parse(f.toString("utf8",s,s+e.size));console.log(j.name,j.version)' <path to app.asar>
   ```

   No package at hand is reported as **not measured**; downloading a 140 to 310 MB installer to
   measure it is the maintainer's call.

7. **Publishing is the maintainer's.** Hand him the command, with the notes as the body:

   ```bash
   gh release edit "desktop-v$V" --repo "$R" --notes-file "docs/releases/desktop-v$V.md" --draft=false
   ```

   After he says it is published, check what installed copies read: the release is no longer a
   draft, and the feed answers 200.

   ```bash
   gh release view "desktop-v$V" --repo "$R" --json isDraft,publishedAt --jq '[.isDraft, .publishedAt] | @tsv'
   curl -sIL -o /dev/null -w '%{http_code}\n' "https://github.com/$R/releases/download/desktop-v$V/latest.yml"
   ```

Report one row per step: the command, its output verbatim, and **done**, **waiting on the
maintainer** (with the one thing he must do) or **stopped** (with why). Name what was not
measured: the version inside `app.asar` without a package, the `dmg` opened on an Intel Mac
(the gate runs the unpacked app), and an installed copy actually updating.
