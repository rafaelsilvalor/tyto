---
'@tyto/desktop': minor
---

TYTO-42 — a problems panel, a template picker and an artwork list that move the editor

Three panels, and what they share is that each one connects something the window already
knew to somewhere in the brief.

- **A problems panel under both panes**, listing every diagnostic with its severity, its
  code, its message and the line and column it points at. Clicking one selects that exact
  range in the editor, scrolls it into view and focuses it — the range travels as the offset
  pair the parser produced, so nothing converts it on the way. A diagnostic about the
  project rather than about a span of the brief is listed and is not a button, because there
  is nowhere for it to take you.
- **A template picker** over the editor, reading the registry's manifests — name,
  description, formats, and a `preview.png` when a template ships one. Choosing a template
  rewrites the frontmatter's `template:` line as an ordinary editor edit, which is what makes
  the preview, the panel and Ctrl+Z all work with no second code path. A brief with no
  frontmatter gains one.
- **The artwork list is driven by the brief's artworks, not by the frames on screen.** A
  slide that renders to one format only used to vanish from the list when the other tab was
  picked. Selecting a slide now also scrolls the editor to the `::directive` that created it.

`brief:preview` gains an `artworks` list carrying each artwork's source range, which is the
one thing a frame cannot carry: a `Scene` has no source position, so the number is picked up
in `resolve` and passed forward. `templates:list` is a new channel. A folder that meant to be
a template and could not be read as one now reaches the panel as the registry's own
diagnostics — nothing said so before, because the preview service replays the registry's
warnings and those failures are not among them.

The panel sizes to its contents up to 30vh and scrolls past that. It was a flat 168px until
the window was opened and measured: a clean brief reserved all of it to say "nothing to
report", and the preview fitted a 1080×1080 frame at 32% instead of 44%.
