# The queue folder

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

The **local queue** renders briefs that arrive in a folder, without opening them. Another program — or you, by hand — drops a brief into the folder, and Tyto writes the files next to it. It works while the window is open.

## Set it up

1. Open the queue: **Show the local queue** in the command bar, or the queue button in the status bar. It opens in the left area.
2. Click the folder button in the panel's header (**Choose folder…**) and pick an empty folder. Tyto makes an `inbox` folder inside it, and the panel shows its path under **Drop task folders into**.
3. Under **Produces**, tick the file types the queue should write. PNG alone is ticked at first.
4. Tick **Render automatically** to render every task as it arrives. Leave it off to render each one with its **Render** button.

The choices are kept in [`settings.json`](../reference/settings.md): the folder in [`queueFolder`](../reference/settings.md#queuefolder), **Render automatically** in [`queueAutoRun`](../reference/settings.md#queueautorun), and the file types in [`queueKinds`](../reference/settings.md#queuekinds), one list per queue folder. **Forget folder** stops watching it.

## Add a task

A **task** is a folder inside `inbox` holding a file named exactly `brief.brief`:

```
queue/
  inbox/
    open-day/
      brief.brief
      assets/        (optional: images the brief uses)
```

Make the folder somewhere else and move it into `inbox` once the brief is written, so Tyto never reads half a file. An image the brief names is looked for beside the brief first, then in `assets/`.

The task shows in the panel as **pending**, with **Render** and **Open brief**; with **Render automatically** on it starts by itself.

## What it writes

When a task is done:

```
queue/
  outbox/
    open-day/
      out/
        grid-01.png
        result.json
  done/
    open-day/
      brief.brief
```

- `outbox/<task>/out/` holds the files, named as in [Export](./index.md#what-is-written), and `result.json`, which lists every file and every problem.
- The task folder moves from `inbox` to `done`, so it is not rendered twice and the brief is never deleted.

The panel marks the task **done** and offers **Open out/ folder**.

The [Settings](../reference/settings.md) reference lists the three keys with their types and defaults.
