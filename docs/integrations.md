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

## The `tyto` command

`apps/cli`, the composition root that turns the contract above into a process. Four commands:

| Command                        | Does                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `tyto render <brief> --out`    | one brief → artifacts + `result.json` in `--out`. The contract above                |
| `tyto watch <folder>`          | `<folder>/inbox/<id>/` → `<folder>/outbox/<id>/out/`, forever. `--once` for a sweep |
| `tyto template check <folder>` | manifest, then markup, with line and column. No brief, no `formats.yaml`            |
| `tyto template new <name>`     | scaffolds a template folder from `docs/template-authoring.md`                       |

A project is two paths, both overridable: `--templates` (default `templates/`, one subfolder
per template) and `--formats-file` (default `formats.yaml`). `--types png,jpeg,webp,svg`
chooses the encodings and defaults to `png`; `--scale` and `--quality` apply only to the
raster ones, and `--types svg` never launches a browser at all.

**`--template` and `--formats` are fallbacks, not overrides.** Each is used only when the
brief's frontmatter says nothing on that subject, so what a brief says about itself always
wins over what one run says about the brief. A format either of them names that the chosen
template does not render is `E_UNKNOWN_FORMAT`, with the frontmatter's range when the
frontmatter asked and no range when the flag did — a flag is not a position in a file.

Diagnostics go to stderr as `path:line:col: severity CODE message`, and artifact names go to
stdout one per line. `--json` replaces both with one document on stdout; it carries a line
and column per diagnostic, which the `result.json` on disk deliberately does not — that
document is this contract and carries offsets.

**A command line the parser refuses exits 1**, alongside the error diagnostics. It is not an
internal failure: the caller has to change something before the same invocation can work, and
that is exactly what separates 1 from 2 for a reader deciding whether to retry.

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
