# Formats

A **format** is a size: the canvas one artwork is drawn on. A brief asks for formats in its `formats:` line and gets one image per format, for every artwork.

::: tip
The example is for `notice`, the manual's own template. Copy [its folder](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) into [your templates folder](../templates/templates-folder.md) to run it.
:::

<<< @/../examples/briefs/formats.brief{md}

This brief asks for the story only, although `notice` also draws `grid`. Leave the line out and you get every format the template draws; ask for one it does not draw and the brief is `E_UNKNOWN_FORMAT`.

## The formats that come with Tyto

The [template gallery](../templates/gallery.md#formats) lists them with their sizes. Their names follow one rule: **a kind of piece's usual size is named by the kind alone, and any other size adds its proportion.**

- `grid` is a post in the feed, at the usual 4:5; `grid-1x1` is the square post.
- `story` is a story.
- `banner` is the usual banner; `banner-1x1` and `banner-345x146` are the square one and the small strip.

## Carousels and stories are not formats

A carousel is several `grid` artworks in a row, and stories are several `story` ones. What makes a series is the template having a slot that repeats, not the size — see [Several artworks](./carousels.md). The gallery says what each template makes: a grid, a carousel, a story, stories or a banner.

## Where the sizes come from

From a file called `formats.yaml`, the one place a size is written: each line gives a name, a width and a height in pixels, and the kind of piece. Tyto ships one with its templates. A [templates folder](../templates/templates-folder.md) of yours can carry its own `formats.yaml` beside the templates, which then replaces the built-in one; without one, the built-in sizes apply.
