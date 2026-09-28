# 0048 — An installed code template runs in its plugin's process, and its faces cross with the call

Status: accepted · 2026-09-27 · TYTO-189 · amends ADR 0046, extends ADR 0038, ADR 0041 and ADR 0042

## Context

ADR 0046 let an installed plugin ship a template pack, but only markup. A folder with a
`template.ts` or with no `template.html` was `E_PLUGIN_PACK_CODE`. The reason was the boundary,
not the format. A code template from a folder would have been imported by the CLI or the
desktop's main process and run with Tyto's privileges, and not behind the plugin's thread
(ADR 0041). Production templates are written in TypeScript first (`agenda-semana` was the first).
So none of them could be distributed as a plugin.

Opening that door through the boundary raises one question the other callables did not.
`TemplateContext.measure` (ADR 0038) is synchronous: a template calls it in the middle of
`build`, before it places the text, and uses the answer to size what surrounds it. It measures
against the host's font cache. A function does not cross a message boundary, so the guest needs
a way to answer the same question.

The two options were measured on `agenda-semana`'s example brief, which makes 16 measurements
per render, before anything was built. A throwaway probe on `origin/main` (cc4ca1d) ran 500
renders in-process and 200 sequences of 16 round trips over `worker_threads`. Three runs:

```
PROBE in-process n=500: compile median 1.215 ms p90 1.816 ms; build 0.417 ms/render; measure 0.202 ms/render (12.6 us/call)
PROBE reverse calls (16 sequential round trips incl. host measure) n=200: median 1.351 ms p90 1.522 ms => 84.5 us/round trip
PROBE ship data: 3 faces, 1290568 B; structuredClone median 0.231 ms; cold cache (parse + 16 measures) median 57.841 ms
PROBE in-process n=500: compile median 1.632 ms p90 2.907 ms; build 0.591 ms/render; measure 0.288 ms/render (18.0 us/call)
PROBE reverse calls (16 sequential round trips incl. host measure) n=200: median 1.378 ms p90 1.770 ms => 86.1 us/round trip
PROBE ship data: 3 faces, 1290568 B; structuredClone median 0.241 ms; cold cache (parse + 16 measures) median 62.108 ms
PROBE in-process n=500: compile median 1.232 ms p90 1.991 ms; build 0.426 ms/render; measure 0.208 ms/render (13.0 us/call)
PROBE reverse calls (16 sequential round trips incl. host measure) n=200: median 1.363 ms p90 1.539 ms => 85.2 us/round trip
PROBE ship data: 3 faces, 1290568 B; structuredClone median 0.238 ms; cold cache (parse + 16 measures) median 57.095 ms
```

The probe's first version reported 305 ms per render for the round trips. That was a bug in the
probe (the worker added a listener per round, so every answer multiplied) and not the boundary.
The numbers above are after the fix. `utilityProcess` was not measured.

## Decision

### A pack's `build`, called in the plugin's process

`TemplatePack` gains an optional `build(template, context)`, which returns a frame. A folder in
an installed pack with a `manifest.yaml` and **no `template.html`** is a code template, and the
pack's `build` draws it by manifest name. The plugin bundles the code into its `dist/`, as it
does the rest of its module. **Nothing is imported from a template folder**, and a `template.ts`
there is still `E_PLUGIN_PACK_CODE`, now worded as "Tyto never imports it". So is a code-template
folder in a pack that registered no `build`.

`build` is the `template-pack` point's first callable (ADR 0041's table), and it is optional
there: a markup pack registers none. It goes through the same call-by-id mechanism as
`exportFrame` and `transform`, so ADR 0042's 30 s deadline, the crash handling and the
`E_PLUGIN_PROTOCOL` check all apply without being written again. The answer is checked on the
host's side against `frameSchema` before anything else sees it, and `compile` then checks the
scene as it checks every template's (`parseScene`).

**A failure is `E_PLUGIN_TEMPLATE`, naming the plugin and the template, and it is not fatal**
(ADR 0025). It wraps the underlying message: the timeout, the crash, the throw, or the schema's
complaint. It costs the frame the call was for. The frames that did arrive are drawn, and the job
continues with the diagnostic.

**The in-process path does not exist.** `installedTemplateSource` in `@tyto/io` is the only
thing that loads an installed code template, and it only calls the proxy. A perturbation that
imports the plugin's module into Tyto's thread instead turns three tests red: the one that checks
the frame was built on a thread other than the CLI's, the `font:<family>` test that expects the
face to be sent, and the byte-for-byte acceptance test. The `while (true)` test does not go red.
It hangs the suite, because Tyto's own thread is the one spinning.

### The faces cross with the call

**Chosen: data shipped with the call. Rejected: a call back to the host for each measurement.**

The deciding reason is the contract, not the milliseconds. A reverse call cannot answer
synchronously. ADR 0041 already rejected `Atomics.wait`, because `utilityProcess` shares no
memory with main. So `measure` would have to return a `Promise`, and every template's `build`
would have to become async, built-ins included, to serve the installed ones. Shipping the faces
keeps `measure` synchronous in the guest.

- **The manifest declares what it measures**: `faces: [{ family, weight, style }]`, which is
  new and optional in `templateManifestSchema`. It is read with the rest of the manifest, and
  nothing runs to find out. Only an installed code template reads it. A built-in measures in
  Tyto's own process and needs none.
- **The host sends each declared face's bytes once per plugin process.** The guest keeps them
  and rebuilds `measure` over them with core's own `measureText`. That function is bundled into
  Tyto's guest bootstrap and not into the plugin, so ADR 0038's promise still holds: what the
  template is told a node measures is what `compile` then lays out on the host's side, the same
  function over the same bytes.
- **A face the manifest does not declare measures as `undefined`** in the plugin, which is ADR
  0038's "cannot measure", never zero. `compile` still lays the text out against the host's
  faces afterwards.

The cost is the first render of each process: 1.29 MB cloned in 0.24 ms, and about 58 ms to
parse the three faces and measure. After that a measurement costs what it costs in-process.
The round trip would have cost about 1.1 ms more per render on every recompile, and the async
contract with it.

### A face installed on the machine crosses only under `font:<family>`

Faces fall into three groups:

- **Faces bundled in `@tyto/fonts`** are sent freely.
- **A face installed on the machine** (ADR 0037) is sent only to a plugin whose manifest
  declares `font:<family>`. The person approves that permission at install, like any other
  permission. Such a file can be a licence the person holds and the plugin's author does not
  (CircularXX is one), and the plugin's process is not a sandbox until TYTO-186 (ADR 0041). Without
  the permission the face is withheld: the template measures it as `undefined`, and the load
  reports `W_PLUGIN_FONT_WITHHELD`, naming the plugin, the template and the family.
- **Faces inside the plugin's own folder** would be sent freely. Nothing supplies them yet: no
  mechanism lets a template name a face in its plugin's folder, and a `FontRef` with
  `source: 'file'` comes from the brief's folder. That mechanism is TYTO-192.

`FontLibrary.fromMachine(face)` tells the first group from the second. A `system` face the
machine lacks is answered with the bundled substitute (ADR 0037), which is bundled and crosses
freely. That is what CI, which has no CircularXX, always does. A test gives every machine a
"machine" CircularXX from a folder of its own, so that the approval path runs on CI too.

### `compile` answers later only on this path

`DeferredTemplate` is a manifest and a `buildLater(context)` that answers a
`Result<Frame, Diagnostics>` later. It has a different field name from `Template.build`, so one
cannot reach `compile` by mistake. `compileDeferred` asks for every frame first, one call at a
time and in `compile`'s order, and then hands the answers to the same loop `compile` runs. Layout,
the gap stamp and `parseScene` are therefore one piece of code for both. The job calls
`compileDeferred` for a deferred template and `compile` for every other one.

The built-in path is byte-for-byte what it was. `agenda-semana`'s example brief was rendered to
SVG and PNG with `compile.ts` from `origin/main` and again with this one, through the same CLI
build, and `cmp` found every file identical: `slide-1-retrato.svg` (500 721 B),
`slide-2-retrato.svg` (232 370 B), `slide-1-retrato.png` (118 352 B) and `slide-2-retrato.png`
(102 826 B).

## Consequences

- `agenda-semana`, bundled into a plugin with every `@tyto/*` import inlined and installed
  under the system's temp folder, renders from `tyto render` byte for byte as the in-repo
  template does. Leaving `@tyto/template-kit` out of the bundle refuses the plugin at activation,
  which is the proof that nothing above the temp folder resolved it.
- `tyto plugin new --code` scaffolds a code template in plain JavaScript that installs and
  renders on the first try. It measures its title and sizes a band behind it.
- `TemplateSource.load` answers `Template | DeferredTemplate`. `LocalTemplateSource` is the
  narrower one that the markup and built-in routes return, so the desktop preview and the tests
  still hand `compile` a `Template`.
- A text node the plugin returns carries no source ranges, because `text/origin.ts` keeps them
  in the host's memory. So a `W_TEXT_OVERFLOW` about an installed code template names the node,
  not the slot.
- **An app runs installed code templates only when it says so.** `installedPacks` takes
  `allowCode`, which is off by default, and the CLI passes `true`. Any caller without an
  isolated runner, or one that forgets the option, gets `E_PLUGIN_PACK_CODE` ("a code template,
  which this app cannot run from a plugin yet"), never a template it would have to draw some
  other way. The desktop turned it on in TYTO-189's second pull request, beside its
  `utilityProcess` runner, for the preview, the export and the queue (which stays PNG-only,
  ADR 0044).
- **Measured on the desktop**, through the preload, on the maintainer's machine, where
  CircularXX is installed and so crosses under `font:CircularXX`. `agenda-semana`'s example has
  2 frames and 16 measurements. `cartaz` is one frame with no measurement, so its whole preview
  is an upper bound on one `utilityProcess` round trip. Three runs of
  `code-templates.desktop.test.ts`:

  ```
  MEASURE … first in-repo 181.0 ms, then first through the plugin 108.1 ms; warm median n=20: plugin 59.2 ms, in-repo 57.3 ms; cartaz (1 frame, 1 round trip, no measurement) 3.2 ms
  MEASURE … first in-repo 166.3 ms, then first through the plugin 109.8 ms; warm median n=20: plugin 68.9 ms, in-repo 61.6 ms; cartaz (1 frame, 1 round trip, no measurement) 3.8 ms
  MEASURE … first in-repo 159.6 ms, then first through the plugin 104.1 ms; warm median n=20: plugin 60.2 ms, in-repo 55.5 ms; cartaz (1 frame, 1 round trip, no measurement) 3.6 ms
  ```

  The first plugin preview costs 40 to 49 ms more than its warm ones. That is the faces crossing
  and being parsed in the guest, against the 58 ms estimated on `worker_threads`. Warm, the
  boundary adds 2 to 7 ms to a preview of 55 to 62 ms.
