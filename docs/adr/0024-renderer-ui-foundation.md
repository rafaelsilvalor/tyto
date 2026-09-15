# 0024 — Lit for the renderer, and a window whose layout is data

Status: accepted · 2026-09-15

## Context

Tyto is an environment, not a screen: several briefs open at once in document tabs, panels the user shows, hides and resizes, and a command bar. The renderer as E9.1–E9.3 left it is hand-written DOM — an `index.html` with fifteen hard-coded ids, a `main.ts` that looks each one up by name, and four painter functions that rewrite their subtree from state.

The framework question had been pushed twice with nobody owning it: `shell.ts` deferred it to E9.2, E9.2's `shell.css` deferred it to TYTO-96, and TYTO-96's scope is colour, typography and spacing. This is where it is decided.

### What was measured

Three painters, timed in the system Chrome (HeadlessChrome 153) against the shipped stylesheet, as the median of 25 batches of 40 calls. The axis is panel count; one panel is the window as it ships, and each extra one is a dock with sixty rows in it.

```
paineis  elementos  [data-i18n]    paint()  paintPreview()  paintPanel()  repaint()  repaint sem layout
      1        50          15      0.070           0.470         0.707      4.965               0.760
      3       944          37      0.138           0.268         0.578      6.018               0.832
      5      1572          59      0.148           0.360         0.738      6.652               0.885
     10      3142         114      0.280           0.313         0.592      9.265               1.343
     20      6282         224      0.640           0.305         0.607     12.700               1.568
     40     12562         444      1.127           0.270         0.633     20.678               2.898
```

**The `[data-i18n]` walk is not the cost, and the card that asked for this measurement assumed it was.** It is 0.070 ms today and 1.127 ms at forty panels — between 1 % and 5 % of a repaint. What costs is `stageBox()`: resolving `fit` reads `getBoundingClientRect` after the other three painters have dirtied the document, which forces a synchronous layout of the whole page. The last column is the same repaint with that read removed, and the gap between the two columns is the forced layout: 4.2 ms today, 17.8 ms at forty panels.

**Performance therefore does not force a framework at the size being planned.** A repaint is 4.9 ms today and 9.3 ms at ten panels, inside a 16.7 ms frame; it crosses that budget somewhere past twenty. The Zed-shaped window below has seven.

Second measurement: the problems panel built three ways — as it shipped, on Lit, and on Preact — and timed on the two things the renderer does to it. Filling it from nothing, and changing one diagnostic of two hundred, which is the per-keystroke path. The first row is the floor: building the state and converting every offset to a line, touching no DOM at all.

```
abordagem   preencher 200   trocar 1 de 200   nos no painel   mantem os nos
só o estado         1.790             1.790               0             nao
na mão              3.470             3.410            1000             nao
lit                 2.175             1.925            1001             sim
preact              5.345             2.900            1000             sim
```

Above that floor, changing one row of two hundred costs **1.62 ms hand-written, 1.11 ms on Preact and 0.14 ms on Lit**. The mechanism is the last column, asserted rather than inferred: `replaceChildren` destroys and rebuilds all thousand nodes, while both component models hold the nodes they did not change. It follows — reasoned from that column rather than measured — that a scroll position survives a repaint on both prototypes and could not on the version that shipped, because there was no node left to hold it.

Third measurement: what each library adds. The same panel, bundled minified with the app's own bundler.

```
na mão    2.81 kB   gzip 1.14 kB
preact   16.49 kB   gzip 5.96 kB    (+4.8 kB gzip)
lit      24.21 kB   gzip 8.14 kB    (+7.0 kB gzip)
```

In the app itself, measured by building the renderer with and without the change, the bundle goes from 1 094 103 to 1 119 519 bytes — **+24.8 kB, or 2.3 %**, on a bundle CodeMirror already dominates.

**Neither bundle figure decides anything and neither does line count.** The app ships a ~200 MB Electron; two kilobytes between the candidates is not a number to choose on. The panel is 71 lines hand-written, 65 on Lit and 64 on Preact — a framework does not make a panel shorter, and anybody expecting it to has the wrong reason for wanting one.

### What does force the change

Not speed and not size: **the window has to become data, and the renderer cannot express that.** A panel that can be closed, reopened and resized must be a record somewhere — which panel, in which dock, open or not, how wide — and today a panel is a `<div>` in `index.html` plus a `getElementById` in a frozen `elements` object plus a bespoke painter. None of those three is addressable by a record. A component model makes a panel one value: a tag name the dock instantiates.

## Decision

**Lit 3, rendering into light DOM.** Chosen over Preact on the measurement above — eight times cheaper on the per-keystroke path — and over staying hand-written because of what the previous paragraph says rather than because of any number. Three properties of the repo settle the rest:

- **No build knob.** Lit is plain TypeScript with tagged template literals. JSX would mean teaching `tsconfig.dom.json`, `electron.vite.config.ts` and `eslint.config.js` about a transform, in a package whose two-runtime split is deliberately declared in exactly those three files.
- **No shadow DOM.** `createRenderRoot()` returns the element itself, so `shell.css` reaches every class inside a panel. TYTO-96 is about one visual language for the whole window, and a panel styled somewhere the shell's stylesheet could not reach would be the first thing to drift out of it. Encapsulation is not what these elements are for.
- **The Content-Security-Policy admits it.** `index.html` carries `default-src 'self'` and names no `script-src`, so no `unsafe-eval` reaches the page and nothing may build a function from a string. Lit compiles no templates at runtime. This was read off the policy rather than exercised against a candidate, and it rules out a whole class of foundation before any of them is tried.

### The layout, settled

Seven panels in four docks, plus a status bar and a command bar:

```
┌──────────────────────────────────────────────────┐
│ campanha.brief ×  promo.brief ×            ⌘K    │  document tabs + command bar
├─────────┬────────────────────┬───────────────────┤
│TEMPLATES│                    │ PREVIEW           │
│ FILES   │  editor            │  format tabs,     │
│         │  (CodeMirror)      │  slide, zoom      │
├─────────┴────────────────────┴───────────────────┤
│ PROBLEMS │ QUEUE │ LOGS                           │  bottom dock, tabbed
├──────────────────────────────────────────────────┤
│ status bar                                       │
└──────────────────────────────────────────────────┘
```

**No panel is bound to a dock.** The arrangement above is the default record, not a structure: a panel is `{ panel: 'tyto-problems', dock: 'bottom', open: true, size: 240 }`, and the dock creates the element from the tag. What a person can do with it in the next cards is **show, hide and resize**, with the arrangement and the sizes persisted. Dragging a panel from one dock to another is a later card and needs no change to the shape above — that is the whole reason the shape is a record.

**No docking library, and its cost is therefore not measured.** The card asked what one would cost in bytes and in what it assumes about its host; none was installed, so that number does not exist and this ADR does not invent it. The reason is that the thing a docking library is for — dragging a panel from one dock to another — is explicitly not in the next card, and a dependency bought for an interaction nobody is building yet is a second framework decision made on no evidence. Show, hide and resize is a splitter and a record. When dragging does get a card, that card measures the libraries against a dock that already exists, which is a far better comparison than this one could have been.

### The browser-tab premise, replaced

Five comments — `shared/ipc.ts`, `main/templates.ts` and its test, `preload/index.ts`, `renderer/main.ts` — said the desktop renderer would one day run in a browser tab with no Electron under it. **It will not.** The desktop renderer is a desktop renderer. This is written down rather than deleted quietly, because two of those comments are load-bearing for a reason that survives the premise: a template's `preview.png` still crosses the bridge as bytes rather than as a path, because the renderer's CSP forbids reading a file from disk, and `window.tyto` is still typed optional, because the window is painted once before the bridge answers and the test suite drives the renderer with no bridge at all. Those reasons are now stated as themselves.

Two things this does **not** touch, and they are the two that matter:

- **The window still has a browser tab's powers, not a Node process's** — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, asserted by name in `e2e/window.desktop.test.ts` (ADR 0001). A foundation needing Node in the renderer would be disqualified by this, and Lit does not.
- **The pure packages still run in any runtime** — `core`, `brief-lang`, `template-lang`, `export-*` and `templates` import no Node and no DOM (ADR 0010). That is what makes the cloud possible and it has nothing to do with the user interface. `lit` is a dependency of `apps/desktop` alone.

## Consequences

The problems panel is `<tyto-problems>` and the hand-written `paintProblems` is gone — no third copy of it anywhere. Its two `data-range-*` attributes and the `closest()` that parsed them back out went with it: a row hands the range object straight to the callback.

Three painters are left in the renderer — the `[data-i18n]` walk, the preview pane and the two `<select>` fillers — and they stay until a card needs them to move. The measurement says they are not costing anything, and converting them here would be the "rewrite it all" that this ADR is trying not to be.

Every element needs `display` in `shell.css`. An unknown tag is `display: inline`, on which `flex` and `overflow` do nothing, and the failure is silent.

Every test that changes a property must `await element.updateComplete`. Lit schedules on a microtask, so the DOM one statement after an assignment is the DOM from before it.

The `fit` zoom still forces a synchronous layout on every repaint, and that is now the renderer's largest single cost by an order of magnitude. Nothing here fixes it; it is written down so that the next person to look at a slow window starts where the number is rather than where the comment was.
