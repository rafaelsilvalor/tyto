# Command line

::: info How this page was checked
Every command was run on 2026-10-19 on a build of the repository at commit `b039537` (CLI 0.4.1) on Windows 11. The outputs below are copied from those runs; where one is long, the first lines are shown and the page says so.
:::

The `tyto` command does from a terminal what the window does: render a brief, watch a folder for briefs to render, check and start templates, and manage plugins. It is what a script, a scheduled job or another program uses.

## Get the command

`tyto` is not part of the desktop installer yet. It runs from a copy of the [repository](https://github.com/rafaelsilvalor/tyto), with [Node.js](https://nodejs.org) 22 or 24 and [pnpm](https://pnpm.io):

1. Get the repository and install what it needs: `pnpm install` in its folder.
2. Build the command and check it answers:

   ```
   $ pnpm cli --version
   0.4.1
   ```

3. From then on, run it from any folder as `node <repository>/apps/cli/dist/index.js`. The pages here write `tyto` for short; a shell alias or a small script named `tyto` makes that literal.

<!-- The CLI ships with no installer (apps/cli is private); a card candidate raised in TYTO-317. -->

## Before the first render: sizes and templates

`tyto render` and `tyto watch` read two things from the folder you run them in:

- **`formats.yaml`**, the sizes — `grid` is 1080 × 1350, `story` 1080 × 1920 and so on. Without it, a render stops with `E_FORMATS_READ`. Copy the one Tyto uses, `packages/templates/templates/formats.yaml` in the repository, into your folder, or point at it with `--formats-file`. [Formats](../briefs/formats.md) explains the file.
- **`templates/`**, your own templates, one subfolder each, as in [your templates folder](../templates/templates-folder.md). It is optional: the templates that come with Tyto are always there, and `--templates` names another folder.

## What every command shares

- `tyto --help` lists the commands, and `tyto <command> --help` the options of one. [Command line](../reference/command-line.md) in the Reference has every option of every command; these pages say what to use them for.
- **Exit codes**: `0` when all went well, `1` when the brief or the command line has an error, `2` when Tyto itself failed. A script can stop on anything that is not `0`.
- **`--json`** prints a document a program can read instead of sentences.

## In this section

- [Render a brief](./render.md) — files from one brief.
- [Watch a folder](./watch.md) — render whatever arrives in a queue folder.
- [Templates](./templates.md) — check a template and start a new one.
- [Plugins](./plugins.md) — install, list, switch off and remove.
