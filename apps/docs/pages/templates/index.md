# Templates

A **template** is the design an artwork is drawn in: where the title goes, which typeface, which colours, which sizes. A [brief](../briefs/) only fills it in. Tyto comes with a set of templates, and you can add your own.

## Choosing a template

The [template gallery](./gallery.md) shows every template that comes with Tyto: a picture of it, what it is for, the sizes it draws and the slots a brief fills. To choose:

1. **Start from the piece you need.** Each template says what it makes — a single grid post, a carousel, a story, stories or a banner — and in which formats. A carousel template is the one to use for a series of slides; a grid template makes one image.
2. **Check the brand.** Most templates draw one brand's look, and the gallery names it.
3. **Read its slots.** They are what your brief will have to say. A slot marked _required_ has to be in every brief; a list slot shows the values you can pick.

In the window, **New brief from template…** lists every template you can use, with the folder each one came from, and opens a new brief with that template's slots already written out. From the command line, a brief's `template:` line or `--template` chooses it.

## When no template fits

Templates are folders of plain files: a `manifest.yaml` that lists the slots and sizes, and a `template.html` that draws them. **New template…** writes a working one for you to change, and [Your templates folder](./templates-folder.md) is where your own live. Writing a template from scratch is covered in the [template author's guide](../extend/template-authoring.md).
