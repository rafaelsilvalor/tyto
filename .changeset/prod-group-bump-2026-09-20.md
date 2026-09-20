---
'@tyto/brief-lang': patch
'@tyto/core': patch
'@tyto/editor': patch
'@tyto/io': patch
'@tyto/plugin-api': patch
'@tyto/desktop': patch
---

Dependency bumps in the prod group: `yaml` 2.9.0 → 2.9.1, `zod` 4.6.1 → 4.6.5, and
`@codemirror/commands`, `@codemirror/state` and `@codemirror/view` to their latest patches.

These are dependencies of what ships, so they get a patch and a line in the changelog rather
than passing through unnamed. Written by hand because Dependabot cannot write a changeset — it
has no idea this repository uses them — which is what makes every one of its PRs arrive red on
`changeset status`. TYTO-155 is the card for fixing that properly.
