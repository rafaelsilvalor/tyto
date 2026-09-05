If $ARGUMENTS is given, use that card instead of searching.

Find the highest-priority TYTO card in status "To Do" in Jira, skipping any card
whose labels include `blocked-by-*` unless the referenced dependency is already
Done. If several qualify, take the lowest key number.

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
