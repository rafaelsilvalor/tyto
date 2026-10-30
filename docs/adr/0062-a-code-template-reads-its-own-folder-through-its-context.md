# 0062 — A code template reads its own folder through its context

Status: accepted · 2026-10-01 · TYTO-214 · extends ADR 0005 (a template is markup or code) and
ADR 0048 (an installed code template's context crosses without its functions)

## Context

TYTO-176 handed a markup template the files in its own folder in the desktop window, as `tyto
render` already did: `fileTemplateAssets` in `@tyto/io` reads the folder and its answer goes
to `markupTemplateSource`, so `<image src="assets/bg.png">` resolves. A code template
(`template.ts`, bundled into the application) had no such route. `bundledTemplateSource`
returned `defineTemplate(manifest, build)`, and the context `build` receives had no field that
names a file.

Measured on `origin/main` 7efc445 with a throwaway test that ran `tyto render --types svg`
on a bundled code template whose folder holds `assets/bg.png`. The best a template could
write was a hand-made ref with the folder-relative path and a guessed hash, because it has
no bytes to hash:

```
PROBE exit=1
PROBE context keys: format,size,idPrefix,artwork,slots,adjustments,measure,report
PROBE files: grid-01.svg result.json
PROBE svg has data:image/png: false
PROBE json: [{"severity":"error","code":"E_EXPORT_ASSET_UNRESOLVED","message":"Asset 'assets/bg.png' on 'artwork-1.grid.0' was not resolved to embeddable bytes, and an export makes no network requests.","path":"brief\\b.brief"}]
```

The only way a code template drew a picture was through a brief slot (`agenda-semana`'s
`imagem` and `selo`). TYTO-210's product banner draws text over fixed backgrounds, in three
sizes, and production templates are written in TypeScript first.

## Decision

**`TemplateContext` gains `files: TemplateFiles`**, two synchronous questions:
`image(path)`, which answers an `AssetRef` whose bytes were already read, and `svg(path)`,
which answers the markup. Paths are relative to the template's folder, as `src=` is.
`undefined` means the folder has no such file.

- **One shape for both kinds of template.** `TemplateFiles` lives in `core`, and
  `template-lang`'s `TemplateAssets` becomes `Partial<TemplateFiles>`. `fileTemplateAssets`
  answers both already. No second reader.
- **`Template` gains an optional `files`**, and `compile` hands `template.files ?? noFiles`
  to every call. A template with no folder, or loaded by a source that read none, is handed
  `noFiles`, which answers `undefined` for every path. That is exactly what it had before,
  since it could not ask.
- **`bundledTemplateSource` takes an optional `readFiles(directory)`**, called once per load
  for a bundled name the registry found a folder for, after the ambiguity check. `pipeline`
  imports no disk, so the reader is injected. The composition root passes
  `fileTemplateAssets` and keeps the `resources` it returns for the exporters, as it does on
  the markup route. Left out, nothing is read.
- **An installed plugin's code template is handed `noFiles`.** `files` is functions, and like
  `measure` and `report` it does not cross the process boundary (ADR 0048). `TemplateCall`
  omits it, `installedTemplateSource` strips it, and the guest rebuilds it as `noFiles`.
  Reading a plugin's own folder for its templates is left open, beside TYTO-192.
- **A format picks its own background by path.** The context carries the format, so a
  template with three sizes keeps three files and asks for
  `` `assets/bg-${context.format}.png` ``. No `extends` is needed, and the worked example is in
  `docs/template-authoring.md`.

## Consequences

- With the reader wired, a code template draws its own folder's files in any program that
  composes `bundledTemplateSource`. **This change wires no program.** `apps/cli` and
  `apps/desktop` were occupied by other cards, so each gets its own follow-up pull request
  that passes `readFiles` and carries that program's acceptance test. Until those land, both
  programs behave as before.
- A context built by hand has one more field. The three in `packages/templates`' tests pass
  `noFiles`, as they pass `measureNothing` and `reportNothing`.
- `core`, `template-lang` and `template-kit` still import no Node or DOM. The reader stays in
  `@tyto/io`.
- Not measured: whether a markup frame that `extends` another can override an inherited
  `<image src>`. A markup template gives each format its own `src` in its own `<frame>`.

## Note, 2026-10-30 — an installed plugin's own folder (TYTO-478)

The open point is closed: **an installed plugin's code template reads its own folder**, the
way its faces reach it (ADR 0048). `files` still does not cross, being functions. What it
answers does:

- The host reads the template's folder: the one `installedPacks` checked is inside the
  installed plugin, after `realpath` (ADR 0046). `installedTemplateSource` takes the same
  injected `readFiles` as `bundledTemplateSource`, and both apps pass `fileTemplateAssets` and
  keep its `resources` for the exporters, as they do for a bundled template.
- **What crosses is data, never an image's bytes**: `ShippedFiles`, each image as the
  `AssetRef` the host minted and each SVG as its markup, keyed by folder-relative path, as a
  fourth argument of `build`. The guest rebuilds `files` as a lookup over it, so `../x.png`,
  an absolute path and a file the host did not read answer `undefined`, as a missing file
  does. The card asked for a diagnostic naming the plugin there; the coordinator kept the
  contract above instead, since a folder that leads out of the plugin is already refused as
  `E_PLUGIN_PACK_DIRECTORY`.
- `DeferredTemplate` gains an optional `files`, and `compileDeferred` resolves the declared
  images' defaults (ADR 0153) against it instead of `noFiles`.
- `fileTemplateAssets` skips a link whose real target is outside the folder, for every
  caller. The plugin store already refuses such links at install and at load (ADR 0049);
  this is the reader not depending on that.
- The export resolves only the refs the reader minted (`byAbsolute`), so what a plugin can
  embed is unchanged. A plugin minting its own absolute `AssetRef.path` is TYTO-479's
  question and is not touched here.
- **The protocol is 12** (ADR 0149 point 4): a guest on 11 refuses the fourth argument.

Fonts in a plugin's own folder stay with TYTO-192.

## Note, 2026-10-30 — a frame draws only the pictures it was handed (TYTO-479)

The point above left open is closed. Measured at `origin/main` 0164874: an installed plugin's
`build` that answered an image node whose `AssetRef.path` was an absolute path outside every
folder Tyto grants rendered with exit 0, no diagnostic, and that file's bytes in the SVG and
its pixels in the PNG. The frame schema at the boundary accepts any `path`, and the brief's
`fileResources` reads whatever path a scene names — the plugin's process could not read the
file, but the host read it for the frame. A ref with no `path` leaked the same way through an
`id` such as `../../x.png`, which is read against the brief's folder.

- **Every `AssetRef` in an installed code template's answer must be one the host sent that
  call**: an image of the template's own folder (`ShippedFiles`), or one anywhere in the
  context (a slot's picture or a declared value; a brand kit's marks are shapes and carry no ref). It is matched by its resolved
  `path`, or by `id` when it has none, whatever its `source`. Anything else refuses the frame
  as `E_PLUGIN_TEMPLATE_ASSET`, naming the plugin, the template and the asset's `id`.
- This is ADR 0042's rule — a plugin reaches only what crosses — applied to the one thing the
  host reads on a frame's behalf. No new ADR.
- The check is on the host's side of the boundary, in `installedTemplateSource`, so the CLI and
  the window both get it. The schema is unchanged and **the protocol stays 12**.
- Not changed: `fileResources` itself still reads any path a scene names, because a ref the host
  minted (the source cache's, say) may live outside the brief's folder. A `FontRef.path` in a
  frame is the same question for faces, and nothing loads a file face yet (TYTO-192).
