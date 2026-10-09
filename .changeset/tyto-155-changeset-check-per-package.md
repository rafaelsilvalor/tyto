---
'@tyto/desktop': patch
---

TYTO-155 — nothing in the app changes; this corrects the 0.3.2 entry and records how dependency
bumps reach this changelog from now on.

**The 0.3.2 entry gives the wrong reason for the red Dependabot pull requests.** It says every
one of them arrives red on `changeset status` because Dependabot cannot write a changeset. The
measurement that followed showed otherwise: `changeset status` fails only when `.changeset/`
holds no file at all, so a Dependabot pull request was red whenever no other changeset was
pending — right after each version PR — and green otherwise, with no commit of its own. The
0.3.2 entry is left as published; this is its correction.

From now on the pull request check asks whether each changed package is named in a changeset of
that pull request's own, and a Dependabot bump of a dependency that ships with the app (Electron
among them) gets its line here written by the release workflow, naming the old and new version
(ADR 0070).
