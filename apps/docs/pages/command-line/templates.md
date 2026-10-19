# Templates

::: info How this page was checked
Every command was run on 2026-10-19 on a build of the repository at commit `b039537` (CLI 0.4.1) on Windows 11. The outputs below are copied from those runs.
:::

Two commands help with your own templates. What goes inside a template is the [template author's guide](../extend/template-authoring.md); the window's way of editing one is [Template mode](../editor/template-mode.md).

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
