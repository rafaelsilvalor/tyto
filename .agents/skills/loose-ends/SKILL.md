---
name: loose-ends
description: Sweep the `## Left open` sections of the Tyto PRs merged since a date, sort every item (dropped, already a card, fixed since, no card, or a proposed card under one of five criteria) and propose loose-end cards in a table. Use when the maintainer asks for a loose-end sweep ("varre as pontas soltas", "loose ends"). Creates cards only on approval, through the card skill.
---

# Loose ends

Codex port of `.claude/commands/loose-ends.md`. Keep the two in step: a rule changed in one is
changed in the other in the same PR.

Sweep the `## Left open` sections of the pull requests merged since a date, sort every item,
and propose the cards that are earned. Create nothing before the maintainer approves.
The request names the start date, `YYYY-MM-DD`: pass the `Swept to:` date the previous sweep
printed. Without it, the sweep starts 7 days ago, and the report says so in its first line,
because a default window can skip what the previous sweep did not reach.

AGENTS.md › Commits and pull requests puts loose ends under a literal `## Left open` heading
so that a sweep can find them; this command is that sweep. Loose ends left only in a chat are
out of its reach. Run from the repository root, in Git Bash or a Linux shell, with
`R=rafaelsilvalor/tyto`; pass `--repo "$R"` to every `gh`. Paste each command's output
verbatim. Jira reads follow AGENTS.md › Jira: `fields` with only what the step uses,
`responseContentFormat: "markdown"`, and the connector fallback. Nothing is written to the
repository: the next start date travels in the report, so a sweep never needs a commit.

**The default is to fix a loose end, not to card it.** A loose end earns a card of its own
only when at least one of the five criteria below holds, and the report names which by
number. An item that meets none is fixed by the next card that touches its file or package,
in that card's PR (AGENTS.md: fix a loose end on the card's path when its diff is smaller
than the card's).

1. **Needs a closed decision.** It needs an ADR, or reopens one in `docs/adr/`.
2. **Touches what this evidence cannot cover.** It rewrites a snapshot or a visual reference,
   or lives in a package whose suite cannot run here (a darwin reference, a desktop that does
   not build on this machine, a Linux-only path).
3. **Needs context the session lacks.** A credential, a machine, another repository, an
   upstream release, or a decision that is the maintainer's.
4. **Over the size ceiling.** The fix's diff would be bigger than the diff of the card that
   would carry it.
5. **Already another card's.** An open card covers it: cite its key, propose a comment on it
   when the card does not say it yet, and create nothing.

Steps:

1. **Set the window.** With an argument, set `SINCE` to it first; without one, the line
   below sets it to 7 days ago:

   ```bash
   SINCE="${SINCE:-$(date -u -d '7 days ago' +%F)}"; echo "since $SINCE"
   ```

2. **List the merged PRs.** Count them and read the newest merge, which is the next start
   date:

   ```bash
   gh pr list --repo "$R" --state merged --search "merged:>=$SINCE" --json number,mergedAt --limit 200 --jq 'length, (max_by(.mergedAt).mergedAt)'
   ```

   A count of 200 means the list was cut: run again from a later date and sweep in two
   passes.

3. **Extract every item.** The section runs from `## Left open` to the next `## ` heading;
   an item is a table row (the header and the `---` row skipped) or a bullet. A PR without
   the section prints one line that says so; release PRs have none.

   ```bash
   for n in $(gh pr list --repo "$R" --state merged --search "merged:>=$SINCE" --json number --limit 200 --jq '.[].number' | sort -n); do
     gh pr view "$n" --repo "$R" --json body --jq .body | tr -d '\r' |
       awk -v n="$n" '/^## Left open/ { f = 1; seen = 1; next } /^## / { f = 0 }
         f && /^\|/ { rows++; if (rows > 1 && $0 !~ /^\| *:?-+/) print "#" n "\t" $0 }
         f && /^[-*] / { print "#" n "\t" $0 }
         END { if (!seen) print "#" n "\t(no Left open section)" }'
   done
   ```

   Say how many items came from how many PRs, and which PRs had no section. Read the card
   key of each PR from its title.

4. **Drop what the PR already closed.** An item whose status says Fixed, Corrected, By
   design or Noise (or the Portuguese `Corrigido`, `Ruído`) is listed as dropped, with the
   status quoted. It is not proposed. "Out of scope" is not a drop: it says the card did not
   do it, not that nothing is left, so the item goes on to step 5.

5. **Already a card?** Collect every `TYTO-NNN` the remaining items name and read their
   status in one query:

   ```text
   key in (<keys>)
   ```

   with `fields: ["summary", "status"]`. An open card (any status but Done) covers its item:
   cite it. A card in Done covers it only if the thing is gone: check with the grep of
   step 6. For an item that names no key, run one text search over open cards with two or
   three of its distinctive words:

   ```text
   project = TYTO AND statusCategory != Done AND text ~ "<words>"
   ```

   with `fields: ["summary", "status"]` and `maxResults` at most 5. Show **the JQL you
   ran**, so a search that missed is visible. A hit that is the item's own origin card does
   not count.

6. **Fixed since?** Grep `origin/main` (after `git fetch origin main`) for the file, symbol
   or text the item names:

   ```bash
   git grep -n "<symbol or text>" origin/main -- <path>
   ```

   Paste the line. Write "fixed since, read in the code" only with that line under it, and
   name the PR or card that did it when the line's history says so; a grep that finds the
   old text, or nothing, keeps the item open. Never write "fixed" without a grep line.

7. **Apply the five criteria** to every item still open. Merge items from different PRs that
   name the same change into one proposal. Each item ends in one outcome: dropped (step 4),
   already a card (key), fixed since (grep line), **no card, fixed by the next card that
   touches `<file or package>`**, or **proposed card (criteria `<numbers>`)**.

8. **Propose.** Show one table of proposed cards, then one of the rest:

   | #   | Proposed card (title) | From (PR, item) | Criteria | Severity | When |
   | --- | --------------------- | --------------- | -------- | -------- | ---- |

   | PR  | Item (short) | Outcome | Evidence (key, JQL, grep line or quoted status) |
   | --- | ------------ | ------- | ----------------------------------------------- |

   Severity, without inflating:
   - **High**: wrong art reaches the user, or data is lost. Priority `Alta`, label
     `sev-alta`.
   - **Medium**: a declared rule that silently does nothing, or a divergence that breaks when
     somebody edits one side. Priority `Média`, label `sev-media`.
   - **Low**: a coverage gap, ergonomics, or performance with no trigger. Priority `Baixa`,
     label `sev-baixa`.

   When, one of four forms:
   - `Before <X>`: it really blocks X. The card goes to Ready.
   - `Together with the next card that touches <file or package>`.
   - `When <observable trigger>`.
   - `Standalone`.

   Then **stop and wait**. A reply that corrects a detail is not an approval: show the
   corrected table again.

9. **Create on approval, through the card skill.** For each approved proposal, follow
   `.agents/skills/card/SKILL.md` from its step 2 (overlap search, epic, draft, show, create,
   read back), with these additions:
   - The body opens, before `## Why this card exists`, with three lines:

     ```markdown
     **Severity: <High | Medium | Low>** — <one line>

     **When:** <one of the four forms>

     Left open by: TYTO-NN (PR #N)
     ```

   - Labels `loose-end` and the severity label, and the priority in `additional_fields`:
     `{ "labels": ["loose-end", "sev-<level>"], "priority": { "name": "<priority>" } }`.
   - In the card skill's step 7, a card born in Ready goes back to To Do (transition `11`) unless its
     When is `Before <X>`; a `Before <X>` card born in To Do goes to Ready (transition `2`).

10. **Report.** The two tables, the counts (items, PRs, PRs without a section, and how many
    items ended in each outcome), the JQL and grep lines used, and the keys created if any.
    The report's **last line** is the date to pass next time, the newest merge read in step
    2:

    ```text
    Swept to: <YYYY-MM-DD>
    ```

    The search is by day, so the next sweep reads that day's PRs again: an item already
    proposed or created then shows up as already a card, which is the overlap's whole cost.
