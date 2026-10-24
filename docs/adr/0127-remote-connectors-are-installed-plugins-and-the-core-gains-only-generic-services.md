# 0127 — Remote connectors are installed plugins, and the core gains only generic services

Status: accepted · 2026-10-24 · TYTO-368 · refines ADR 0011 and thaws part of E10; builds on
ADR 0007, ADR 0041, ADR 0042, ADR 0049 and ADR 0112. Reasoning in
`docs/explorations/2026-10-24-data-recipes-and-connectors.md`

## Context

ADR 0011 drew the line "Tyto renders, Jacurutu orchestrates" and froze E10 (remote
integrations) "only if Jacurutu does not cover it". Its consequence foresaw the way back: "if
Jacurutu does not cover it, sources return as medium-sized plugins without touching the core".
`CLAUDE.md` states the rule as "Tyto never knows about Jira, Drive, OAuth or machine identity".

On 2026-10-24 the maintainer asked for the first two real plugins, a Jira connector and a
Google Drive and Sheets connector, that together replace Buraqueira's production pipeline
(Jira → the "Avulsas" sheet → back to Jira) and add local manipulation by recipes. Jacurutu
does not cover it: it reads Jira and never writes, and its Drive adapter is used by no command.

The connectors need services the plugin API does not offer: writing a secret, settings,
runnable commands, a panel that talks to its own process, writing files, browser sign-in and
scheduled runs.

## Decision

1. **A remote connector is an installed plugin, in its own repository.** `tyto-plugin-jira`
   and `tyto-plugin-google` are not packages of this monorepo. The name of a provider (Jira,
   Google, Drive, Sheets) appears in no package or app here, except as an example in
   documentation and tests.
2. **The core gains generic services only.** Each is described without a provider, and each is
   usable by any plugin that declares it:
   - secret write (`host.credentials` gains a setter, still under `credentials:<key>`);
   - settings for installed plugins (TYTO-254);
   - runnable commands (TYTO-261);
   - a channel between a plugin's panel and its own process;
   - a private cache and host-mediated workspace files (ADR 0130);
   - browser sign-in by OAuth 2.0 (ADR 0131);
   - scheduled recipe runs while the app is open (below);
   - verbs for the recipe notebook (ADR 0128).
3. **The rule is restated as "Tyto knows no provider".** Tyto may know OAuth 2.0 as a
   protocol, as it knows HTTP: the authorize and token URLs, scopes and client id come from the
   plugin's manifest. It never knows a Jira field, a Google API, or who the person is beyond
   what a token the person granted says.
4. **What is one company's goes in its private workspace.** Field ids, status graphs, sheet ids
   and recipes are data in the plugin's section of `.tyto/project.json` (ADR 0112) or a work
   profile. Rules that are code (summary classification, status planning) go in a private
   plugin, since ADR 0079 gave Tyto no user-script tier.
5. **Scheduling runs only while the app is open.** A recipe may declare an interval; the host
   runs it while a window is open, as Buraqueira's watcher does. No system service, no run on a
   closed laptop. This is E10.1 in that one form; the rest of E10's frozen list (Trello, Notion,
   the polling of remote queues into briefs) stays frozen.
6. **ADR 0011's file contract stands.** `tyto render`, `result.json` and the task folder are
   unchanged, and nothing here imports Jacurutu.

## Consequences

- `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/integrations.md` and
  `docs/backlog.md` now say "Tyto knows no provider" instead of naming Jira, Drive and OAuth.
- The plugin API grows a set of services, each with its own card under E11, before either
  connector can be written.
- Plugins that hold real tokens make the advisory network on Node 24 matter more: a plugin that
  imports `node:net` still reaches the network (`docs/plugin-api.md`). Not fixed here.
- Jacurutu's Jira reading becomes redundant once `tyto-plugin-jira` exists. Its future is not
  decided here.
