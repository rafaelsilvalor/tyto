# 0012 — English as the repository language

Status: accepted · 2026-09-05

## Context
The maintainer reads English but writes in Portuguese; the codebase should be readable by any contributor and by AI tooling trained mostly on English.

## Decision
Code, comments, docs, commits, PRs and Jira cards in English; Jira cards carry a Portuguese translation; README is bilingual; UI strings are localized with pt-BR first. Agents reply to the maintainer in Portuguese in chat.

## Consequences
Slot names inside templates remain the author's choice (often Portuguese) because they are the brief writer's vocabulary, not code.
