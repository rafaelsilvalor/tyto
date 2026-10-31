# CLAUDE.md — Tyto

The project's rules live in `AGENTS.md`, shared with every coding agent; this import is how
Claude Code reads them. Change a rule there, not here.

@AGENTS.md

## Claude Code only

- Repository commands are in `.claude/commands/` (`/next-card`, `/handoff`, `/coordinate`,
  `/new-template`). Each has a Codex port in `.agents/skills/<name>/SKILL.md`; a rule changed in
  one is changed in the other in the same PR.
- `docs/agents.md` says how Claude Code sessions and Codex threads reach each other.
