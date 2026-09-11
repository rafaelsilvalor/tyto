If $ARGUMENTS is given, use that card instead of searching.

Find the highest-priority TYTO card in status **"Ready"** in Jira, skipping any
card whose labels include `blocked-by-*` unless the referenced dependency is
already Done. If several qualify, take the lowest key number.

"Ready" is the first column of the board — where Rafael drags a card when he
wants it worked. **"To Do" is the backlog.** Never pick from it on your own: if
"Ready" is empty, say so and name the two or three cards from "To Do" you would
suggest, then wait. Before this status existed the two were one, and nothing
readable through the API told them apart.

Then:

1. Tell me which card you picked and why (one line).
2. Read the spec files it references in `docs/`.
3. Move the card to "In Progress".
4. Follow the Workflow section of CLAUDE.md end to end: branch, implementation
   with tests, `pnpm check` green, Conventional Commit with the key, draft PR,
   card moved to "Review".
5. Report: PR link, what was done, and anything left undone or uncertain.

If the card depends on something that does not exist in the repo yet, stop and
tell me instead of improvising. Talk to me in Portuguese.
