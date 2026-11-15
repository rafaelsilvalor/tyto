# Templates

::: info How this page was checked
Every command was run on 2026-10-19 on a build of the repository at commit `b039537` (CLI 0.4.1) on Windows 11. The outputs below are copied from those runs. **List the templates in reach** was run on 2026-11-15 on a build of the repository (CLI 0.12.0 plus that command) on Windows 11.
:::

Three commands help with templates: one lists those a render can use, two help with your own. What goes inside a template is the [template author's guide](../extend/template-authoring.md); the window's way of editing one is [Template mode](../editor/template-mode.md).

## Start a new template

```
$ tyto template new my-card
templates\my-card\manifest.yaml
templates\my-card\template.html
templates\my-card\examples\my-card.brief
Next: edit template.html, then run 'tyto template check templates\my-card'.
```

It writes a working template into `templates/` — the folder a render reads — with a sample brief in `examples/`. `--out` puts it somewhere else, and `--formats grid,story` chooses the sizes it starts with (`grid` alone if you leave it out).

## Check a template

`tyto template check` reads a template folder the way a render would and reports what is wrong, without rendering anything:

```
$ tyto template check templates/my-card
templates\my-card: no problems found
```

After a mistake — here the manifest asked for a size called `nope` that the markup does not draw:

```
$ tyto template check templates/my-card
templates\my-card\template.html:1:1: error E_TEMPLATE_MARKUP Template markup is invalid: template 'my-card' renders format 'nope' and no frame declares it.
```

The exit code is `0` for a clean template and `1` for one with errors, so a check can run before a template is shared. A template whose layout is a `template.ts` is checked up to its manifest; its code is named, not run.

## List the templates in reach

`tyto template list` prints every template a render in the folder can use, one per line: its name, where it comes from and the sizes it renders.

```
$ tyto template list
banner-teste     built-in   banner, banner-1x1, banner-345x146
carrossel-lista  built-in   grid-1x1, story
meu-cartaz       workspace  grid-1x1, story
promo-curso      built-in   grid-1x1, story
```

- **built-in** comes with Tyto; **workspace** is in the folder's `templates/` or a template folder the [workspace](../editor/workspace-folder.md) names; **plugin** and a name come from an installed plugin or the plugin files.
- An alias is a line of its own, `name → template`, with the sizes its configuration allows.
- It reads the templates exactly as `tyto render` does in that folder, so a name it lists is one a brief's `template:` can use, and a name it leaves out is one a render refuses.
- Give a folder to list what a render there would use: `tyto template list entregas`. `--json` prints the same rows as one document.
- In a [folder you have not trusted](../editor/workspace-folder.md#a-folder-you-have-not-trusted) the project's plugin files are left out, as they are for a render, and a line on the error output says so. `--trust` trusts the folder for this run only.
