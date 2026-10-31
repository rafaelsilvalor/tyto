# Several artworks

One brief can make a whole carousel: a series of grid posts, or of stories. A template that can do it has one slot that **repeats** — the gallery marks it "repeats: one artwork each" — and every time the brief writes that directive, Tyto makes one more artwork.

::: tip
The example is for `notice`, the manual's own template. Copy [its folder](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) into [your templates folder](../templates/templates-folder.md) to run it.
:::

<<< @/../examples/briefs/carousel.brief{md}

In `notice` the repeating slot is `lamina` (slide). This brief writes it four times, so it makes four artworks, each in the two formats it asks for: eight images. The title is written once and appears on every slide.

## One slide different from the others

The braces after a `::lamina` are [adjustments](./directives.md#adjustments) for that slide alone. Here the second slide is highlighted, the third is orange and the fourth is both highlighted and green; the first follows the brief's own settings.

## A picture on each slide

Some templates let each slide carry its own picture. The gallery lists that slot as "per lamina". Write it as `::imagem ./question-1.png` on the line right after the `::lamina` block it belongs to, and the next slide's after its own `::lamina`.

Each `::imagem` goes with the `::lamina` written before it, so there is no limit on how many slides have one. The file is looked for the same way as any other image in the brief, and a file that is not there is underlined on its own line. An `::imagem` before the first `::lamina`, or two of them for the same slide, is underlined too.

### Several pictures among a slide's lines

When the slot is listed as "per lamina · multiple", a slide may hold as many pictures as you write, and each one goes where you write it among the slide's lines. The path stays on the `::imagem` line, and the indented lines under it carry on the slide's text.

Write `::lamina` with the first paragraph indented under it, then `::imagem ./chart.png` with the second paragraph indented under it, then `::imagem ./photo.png`. That slide reads: the first paragraph, the chart, the second paragraph, the photo. The next `::lamina` starts the next slide. A picture whose file is not there is underlined on its own line, and the text under it still belongs to the slide.

## How many slides

A template can set a smallest and a largest number of slides. The gallery shows both under the repeating slot, as "at least" and "at most". A brief with no `::lamina` at all makes one artwork from the other slots — that is how `notice` works, and other templates may require at least one.

## Where the slides go

When you export, each slide's files are numbered in order: `grid-01.png`, `grid-02.png` and so on, one set per format.
