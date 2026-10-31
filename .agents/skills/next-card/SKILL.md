---
name: next-card
description: Take the next Tyto Jira card from the Ready column and carry it to a draft PR, following AGENTS.md's Workflow end to end. Use when the maintainer asks for the next card, or names a TYTO key to work on ("pega a próxima carta", "faz a TYTO-123"). Do not use to coordinate several cards at once; that is the coordinate skill.
---

# Next card

Codex port of `.claude/commands/next-card.md`. Keep the two in step: a rule changed in one
is changed in the other in the same PR.

If the request names a card key, use that card instead of searching.

Find the highest-priority TYTO card in status **"Ready"** in Jira, skipping any card whose
labels include `blocked-by-*` unless the referenced dependency is already Done. If several
qualify, take the lowest key number.

"Ready" is the first column of the board, where the maintainer drags a card when he wants it
worked. **"To Do" is the backlog.** Never pick from it on your own: if "Ready" is empty, say so
and name the two or three cards from "To Do" you would suggest, then wait.

Jira is reached through the Atlassian MCP server configured in the user's Codex config. If no
Jira tool is available, stop and say so; do not guess a card from the repository.

Then:

1. Say which card you picked and why (one line).
2. Read the spec files it references in `docs/`. Check its premise against the code with a
   grep before implementing: a card may describe something already removed or fixed.
3. Move the card to "In Progress".
4. Follow the Workflow section of `AGENTS.md` end to end: branch, implementation with tests,
   `pnpm check` green, Conventional Commit with the key, draft PR, card moved to "Review".
5. Report: PR link, what was done, and anything left undone or uncertain, under a
   `## Left open` table in the PR body.

If the card depends on something that does not exist in the repo yet, stop and say so instead
of improvising. Talk to the maintainer in Portuguese.
