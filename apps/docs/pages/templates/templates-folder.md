# Your templates folder

Your own templates live in a folder you choose, with one subfolder per template. Tyto looks there **before** the templates it comes with.

## Choose it

Run **Choose template folder…** from the command bar and pick the folder. The choice is kept in the `templatesFolder` [setting](../reference/settings.md#templatesfolder), so it survives a restart. **Back to the built-in templates** clears it. **Help ▸ About Tyto** shows which folder is in use.

From the command line, `tyto render --templates <folder>` does the same for one render; without it, `tyto` looks for a `templates` folder in the current one.

## What goes in it

```
Tyto templates/
  notice/
    manifest.yaml
    template.html
  first-card/
    manifest.yaml
    template.html
  formats.yaml        (optional)
```

Each subfolder is one template, named by the `name:` in its `manifest.yaml`. A folder with no template in it is reported in the Problems panel as `E_TEMPLATE_FOLDER_EMPTY`, and the built-in templates keep working.

A `formats.yaml` beside the templates replaces the built-in sizes; without one, the built-in sizes apply. [Formats](../briefs/formats.md) explains the file.

## Run the manual's examples

Every example in [Briefs](../briefs/) is written for `notice`, a small template kept with this manual. To try them in the app:

1. Download the two files of [`notice`](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) into a `notice` subfolder of your templates folder.
2. Copy an example into a new brief. The ones that use an image need [`photo.png`](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/briefs/photo.png) saved beside the brief.

## A template with the same name as a built-in one

Yours wins. A template in your folder named like one Tyto comes with is the one used, and Tyto reports `W_TEMPLATE_SHADOWED` once, naming both, so it is never a surprise. Rename yours to keep both.
