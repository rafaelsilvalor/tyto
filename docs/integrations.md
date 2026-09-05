# Remote integrations

## Boundary with Jacurutu (ADR 0011)

In the Breu suite, **Jacurutu** orchestrates (remote queue → local task → delivery to Drive) and **Tyto** renders (brief → IR → PNG/SVG). Neither imports the other's code. The boundary is a file contract:

```
<task>/
  brief.brief          written by Jacurutu (or by a person)
  assets/              issue attachments
  out/                 written by Tyto
    <artwork>-<format>.png|jpg|webp|svg
    result.json        { status: ok|error, artifacts[], diagnostics[], tyto: {version, templates} }
```

Invocation: `tyto render <task>/brief.brief --out <task>/out` (exit 0 = ok, 1 = error diagnostics, 2 = internal failure). Optional later: Jacurutu imports `@tyto/pipeline` as a library — same contract, no process.

Boundary rules:
- Jacurutu chooses the template (it knows the issue) and writes `template:` in the frontmatter. Tyto validates (it knows the manifest). There is no template catalog outside `templates/*/manifest.yaml`.
- `result.json` is the only thing Jacurutu reads back; acknowledging the issue is its responsibility.
- Tyto never knows about Jira, Drive, OAuth or machine identity.

## What stays in Tyto
- `BriefSource` / `OutputSink` ports in `io` — internal contract used by the local watcher.
- **fs-inbox/fs-outbox** adapter: `inbox/<id>/brief.brief` → `outbox/<id>/…`. Same shape as the contract above, so it doubles as a Jacurutu simulator and as the integration-test harness.
- Desktop queue panel reads the `inbox/` folder — works with or without Jacurutu.

## Deferred (E10) — only if Jacurutu does not cover it
Jira/Trello/Notion/Sheets sources and a Drive sink as Tyto plugins, with per-connection field mapping and a polling scheduler. Contract preserved:
```ts
RemoteBrief { id; source; brief; assets: {name, url|bytes}[]; meta; ackToken }
```
Credentials, if they ever come in, only via `safeStorage`/OS keychain and `host.credentials()`.
