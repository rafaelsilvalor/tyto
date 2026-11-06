---
name: new-adr
description: Reserve the next free Tyto ADR number (the highest on origin/main and in the open pull requests, plus one, or a number a coordinator reserved, checked free) and write docs/adr/NNNN-slug.md with the house title, status line and sections, plus the dated notes in the ADRs it amends or supersedes when asked. Use when the maintainer asks for a new ADR ("abre um ADR", "new-adr"). Commits nothing.
---

# New ADR

Codex port of `.claude/commands/new-adr.md`. Keep the two in step: a rule changed in one is
changed in the other in the same PR.

Reserve the next free ADR number and write the new ADR in the house format. Commit nothing.
The request gives the decision's title, the card key (`TYTO-NNN`) and, when known, the ADRs it
builds on, amends or supersedes, and a number a coordinator reserved for it. Without a title
or a card key, ask for them before step 1.

AGENTS.md › Commits and pull requests: "An ADR number is used only once reserved; confirm it is
still free on `origin/main` right before pushing." Two branches have raced for one number
before, so the number is read from `origin/main` **and** from the open pull requests, never
from the local checkout. Run from the repository root, in Git Bash or a Linux shell, with
`R=rafaelsilvalor/tyto`. Paste each command's output verbatim.

1. **Fetch first**, so `origin/main` is fresh:

   ```bash
   git fetch origin main
   ```

2. **Find the highest number in use.** On `origin/main` (prints the highest; the second
   command prints a number two files share, and nothing when none does):

   ```bash
   git ls-tree --name-only origin/main docs/adr/ | cut -c10-13 | sort | tail -1
   ```

   ```bash
   git ls-tree --name-only origin/main docs/adr/ | cut -c10-13 | sort | uniq -d
   ```

   Then every ADR an open pull request adds, from its file list (the REST list pages past 100
   files; the `files` field of `gh pr list` stops at 100):

   ```bash
   for n in $(gh pr list --repo "$R" --state open --limit 200 --json number --jq '.[].number'); do echo "PR #$n:"; gh api --paginate "repos/$R/pulls/$n/files?per_page=100" --jq '.[] | select(.status == "added" or .status == "renamed") | .filename | select(test("^docs/adr/[0-9]{4}-"))'; done
   ```

   **The next free number is the highest of both, plus one**, written with four digits.

   **A reserved number.** When a coordinator reserved a number for this card, use that number,
   after checking it is free: no file `docs/adr/<number>-*` on `origin/main`, and no open PR
   adds one. When it is taken, stop and say by what (the file on `origin/main`, or the PR
   number and its file); never write the ADR under another number without the coordinator
   saying so. A reserved number below the next free one is not a clash by itself.

   Propose the number with the outputs above, and wait for a yes before step 4.

3. **Read the ADRs it touches.** For each ADR the new one builds on, amends or supersedes,
   confirm it exists on `origin/main`:

   ```bash
   git ls-tree --name-only origin/main docs/adr/ | grep "/<number>-"
   ```

   Read its header and the decision it touches, so the new header names the right decision
   (`decision 3`, `§6`, `point 1`). An ADR that is not on `origin/main` yet is named as such,
   with its PR.

4. **Write `docs/adr/NNNN-slug.md`.** The shape is the one every ADR in `docs/adr` uses; the
   most recent ones (0162 to 0169) are the model.
   - **File name.** `NNNN-` then the title in lower case, words joined by `-`, apostrophes and
     punctuation dropped (`0166-the-menu-bar-names-tytos-own-work.md`).
   - **Title.** `# NNNN — <the decision, as a sentence>`, with an em dash, sentence case and no
     final period: `# 0169 — A line never starts with a standalone operator`.
   - **Status line**, after one blank line: `Status: accepted · <today, YYYY-MM-DD> · <card key>`,
     then, joined with `·`, what it touches: `builds on ADR 0011 and ADR 0127`,
     `amends ADR 0157 §6 (<what changes>)`, `supersedes in part ADR 0045 (<what>)`,
     `extends ADR 0019 (<its title, short>)`. Name every ADR as `ADR NNNN`, and in an amend or a
     supersede say which decision and what changes. Every ADR on `origin/main` is `accepted`.
   - **Sections**, as `##` headings in this order: `## Context` (what forced the decision,
     with what was measured), `## Decision` (numbered `### 1. <claim>` subsections when there
     are several), `## Consequences`. Add `## Rejected` when alternatives were weighed (four of
     the last eight have one); it goes after Consequences.
   - Prose wraps at 100 columns, like the rest of the repository (`printWidth` in
     `.prettierrc`). Run Prettier on this file only:

     ```bash
     pnpm exec prettier --write docs/adr/NNNN-slug.md
     ```

5. **Note the change in each ADR it amends or supersedes, when asked.** Use the most recent
   form, never a new one:
   - **Amends**: a section at the end of the older ADR, as ADR 0019 carries for ADR 0169:

     ```markdown
     ## Note, YYYY-MM-DD (TYTO-NNN)

     <One to three sentences: what ADR NNNN changes in this decision, and what still holds.>
     ```

   - **Supersedes in part**: a dated sentence at the passage it replaces, as ADR 0045 carries
     for ADR 0163 (ADR 0090 carries the same note in bold, for the same ADR):

     ```markdown
     (Superseded on YYYY-MM-DD by ADR NNNN, TYTO-NNN: <what holds now>.)
     ```

   Older ADRs also carry a clause in their status line (`· decision 6 amended by ADR 0161`) or
   a blockquote at the decision (`> **Amended by ADR 0144 (TYTO-423, 2026-10-26).**`); leave
   those as they are. Change nothing else in an older ADR: its decision is closed (AGENTS.md).

6. **No index to update.** `docs/adr` holds only `NNNN-*.md` files; no README or index lists
   the ADRs. If one appears, add the new ADR's row to it in the same step.

7. **Report and hand over.** Paste the outputs of step 2, the number and why, the file's path,
   and the notes added in step 5. End by saying that before pushing, the `pre-push` skill
   (`$pre-push`) must run: its step 4 compares every ADR the branch adds with `origin/main` and
   with the ADRs every other open pull request adds, and prints each clash.

Never commit, push or edit anything beyond the new ADR and the notes asked for in step 5.
