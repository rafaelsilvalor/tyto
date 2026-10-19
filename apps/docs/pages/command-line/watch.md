# Watch a folder

::: info How this page was checked
Every command was run on 2026-10-19 on a build of the repository at commit `b039537` (CLI 0.4.1) on Windows 11. The outputs below are copied from those runs.
:::

`tyto watch` is the [queue folder](../export/queue-folder.md) without the window: it renders every task that arrives in a folder's `inbox`, and keeps going until you stop it. It is meant for a computer that renders for others — a server, or a machine left on.

The folder is laid out as the window's queue: a task is a folder in `inbox/` holding a `brief.brief`, the files go to `outbox/<task>/out/`, and the task moves to `done/`.

## Render what is there and stop

`--once` handles the tasks already in the inbox and exits, which is what a scheduled job wants:

```
$ tyto watch queue --once
open-day: ok — 8 of 8 artifact(s)
```

Afterwards `queue/outbox/open-day/out/` holds the eight images and `result.json`, and `queue/done/open-day/brief.brief` is the brief.

## Keep watching

Without `--once` it looks at the inbox every second (`--interval` changes that, in milliseconds) and prints a line for each task it finishes:

```
$ tyto watch queue
second: ok — 8 of 8 artifact(s)
```

Stop it with **Ctrl+C**. Move a finished task folder into `inbox`, rather than writing the brief inside it, so a half-written brief is never read.

`--types`, `--scale`, `--quality`, `--templates` and `--formats-file` work as for [`tyto render`](./render.md); every option is in the Reference's [`tyto watch`](../reference/command-line.md#tyto-watch).
