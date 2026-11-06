# CLAUDE.md — Tyto

The project's rules live in `AGENTS.md`, shared with every coding agent; this import is how
Claude Code reads them. Change a rule there, not here.

@AGENTS.md

## Claude Code only

- Repository commands are in `.claude/commands/` (`/next-card`, `/handoff`, `/coordinate`,
  `/new-template`, `/pre-push`, `/card`, `/evidence`, `/pr-watch`, `/new-adr`, `/fresh-worktree`). Each has a Codex port in `.agents/skills/<name>/SKILL.md`; a rule
  changed in one is changed in the other in the same PR. `codex-ports.test.ts` in `tools/repo-checks` checks the pair.
- `docs/agents.md` says how Claude Code sessions and Codex threads reach each other.
