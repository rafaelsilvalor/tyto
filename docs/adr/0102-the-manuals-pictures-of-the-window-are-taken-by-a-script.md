# 0102 — The manual's pictures of the window are taken by a script, on demand, from the real window

Status: accepted · 2026-10-18 · TYTO-315 (epic TYTO-311)

## Context

The user manual (ADR 0101) is for a visual application, and a manual of that kind is built around
pictures of the window. Pictures taken by hand go stale with every card that touches the window —
the batch before this one shipped 34 editor pull requests — and the manual has two editions, so
every picture is needed twice, and again in the dark theme.

The desktop end-to-end suite already drives the real window through Playwright, with isolated
data folders (`--user-data-dir` and `TYTO_HOME`, TYTO-139). What it does not do is decide the
window's language, theme or pixel density: the window takes all three from the machine.

## Decision

**1. Every picture of the window in the manual is generated; none is made by hand.** The scenes
are one list, `apps/desktop/e2e/docs-shots/scenes.ts`: a name, the fixture brief it opens (or
none), a window size, the steps that arrange it, and one translated string it shows. One command
takes all of them, in each language and each theme:

```
pnpm build
pnpm --filter @tyto/desktop shots
TYTO_SHOTS_ONLY=command-bar-open,settings-tab pnpm --filter @tyto/desktop shots
```

The pictures are `apps/docs/pages/public/screenshots/<locale>/<scene>-<theme>.png` — `pages/public`
because the site's `srcDir` is `pages` and VitePress serves static files from `<srcDir>/public`.
`TYTO_SHOTS_OUT` writes them elsewhere, which is how two runs are compared.

**2. Each axis is forced, and each picture proves it.**

- **Theme:** the `theme` setting, written into the launch's own `settings.json` with a fixed id
  (`tyto-light`, `tyto-dark`), so the system's scheme plays no part. The runner waits for the
  body to take that theme's `--tyto-surface` and names both colours if it does not.
- **Language:** `--lang=<locale>`. Main and the window both start from `app.getLocale()` — main
  for the menu, the window through `info.locale` — and the switch is what that answers. The
  runner then moves the window with `shell.toggleLocale`, the command a person runs, if
  `<html lang>` is still not the one asked for, and every picture is failed unless the scene's
  string reads exactly `translate(locale, key)`. Exactly, not contained: "Exportar" contains
  "Export".
- **Pixel density:** `--force-device-scale-factor=1`, and every PNG is checked to be the scene's
  size. Without it, this machine's 125% display gave a 1280x802 window at 1.25x and a 1600x1003
  picture.

**3. The capture is Playwright's page screenshot, with the caret hidden and animations
stopped.** It reads the page through the DevTools protocol and never the screen, which is what a
screen copy got wrong once: it captured another application. One launch per picture, in its own
scratch folders, so no scene inherits another's tabs.

**4. It runs when somebody asks for it, and nowhere else.** The runner is
`e2e/docs-shots.shots.test.ts` under its own `vitest.shots.config.ts`: the name keeps it out of
`pnpm check` (`vitest.config.ts`) and out of `test:desktop` (`*.desktop.test.ts`), and no workflow
runs it. It is still a `*.test.ts` in `e2e/`, so `launch-isolation.test.ts` holds its launch to
the same isolation as every suite. The scene list's own rules — a size the CI display can hold, a
proof that differs between the languages, names that are file names — are a unit test in `pnpm
check`.

**5. The pictures are neutral.** The scenes open briefs and a template of their own
(`docs-shots/__fixtures__`), never a brand's. A scene that opens a
brief gets the fixture templates folder in its settings, which is a path on the machine that took
the picture; the settings scene opens no brief, so the `settings.json` it shows holds the theme
alone.

**6. The pictures are stored in Git LFS**, as the visual references are, because they are
rewritten whenever the window changes, which is what LFS is for.

## Consequences

- A card that changes what a scene shows runs `TYTO_SHOTS_ONLY=<scene>` and commits the new
  pictures in its own pull request. Nothing reminds it to: the pictures are not a test.
- Two runs on the same machine give the same bytes: 20 of 20 byte-identical, measured on Windows,
  where the control — the English folder against the Portuguese one — was 0 of 10. A run takes
  about two minutes for the 20.
- The pictures are taken on Windows. The runner is expected to work under the Linux runner's
  `xvfb` — every size fits its 1280x1024 display, which the unit test enforces, and the faces are
  the bundled ones — but that was not measured, and Linux rasterises glyphs differently, so a
  picture taken there would differ from the committed one in every line of text.
- The page screenshot is the page: the system's minimise, maximise and close buttons, which
  Windows draws over the title bar (ADR 0078), are not in the pictures.
- 20 pictures are 937,357 bytes, which every checkout with `lfs: true` downloads.

## Amendment — the template gallery's pictures (TYTO-316, 2026-10-19)

The manual's template gallery (`apps/docs/pages/templates/gallery.md`) shows one picture per
built-in template. They follow this decision, with three differences that come from what they are
pictures of.

- **The command is `pnpm docs:template-shots`**, `tools/docs-gen/src/gallery/template-shots.ts`.
  It runs the built CLI, `tyto render --types png`, on the first example brief in each template's
  `examples/` folder, in the first format its manifest lists, and keeps the first artwork as
  `apps/docs/pages/public/template-gallery/<name>.png`. It drives the binary rather than importing
  the raster adapter, because composing adapters is `apps/*`'s job. Like the window's, it runs when
  somebody asks for it and in no workflow, and the pictures are in LFS
  (`apps/docs/pages/public/template-gallery/*.png`).
- **They need the brand fonts, so any diagnostic fails the run.** A built-in template draws in its
  brand's typeface, which the Linux runner does not have and which a machine without it replaces
  silently but for a `W_FONT_SUBSTITUTED`. The script refuses to write a picture whose render
  reported anything at all, so a machine without the fonts cannot quietly publish a picture in the
  wrong typeface. This is also why they cannot be a check in CI.
- **They show a template's design, never a brand's marks.** A brand's logo and signature stay
  out of the public repository (E15) and reach a render only from a brand kit installed on the
  machine (ADR 0063). The script runs every render with a `TYTO_HOME` of its own, created empty,
  so the templates draw their stand-ins (ADR 0065): the placeholder shape where the logo goes and
  `@assinatura` where the signature goes. Before rendering it asks that same environment for its
  plugins and stops if any contributes a `brand-kit`, so a machine where the isolation leaked
  cannot publish a brand's mark. The layout, colours and typefaces are the template's own, and the
  briefs drawn are the templates' example briefs.

What is checked in CI is the gallery's text: names, descriptions, formats, slots and values are
generated from the manifests and `formats.yaml` and compared on every run, like the Reference
pages, and `apps/docs/test/template-gallery.test.ts` holds every picture the page names to a file
that exists. A template whose look changes needs its picture retaken by hand, which nothing
enforces.
