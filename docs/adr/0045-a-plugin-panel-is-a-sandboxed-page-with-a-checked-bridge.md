# 0045 — A plugin panel is a sandboxed page with a checked bridge

Status: accepted · 2026-09-27 · TYTO-49 · extends ADR 0007, ADR 0042 and ADR 0044

## Context

`docs/plugin-api.md` promised a `panel` point: "UI component in the desktop renderer (sandboxed
iframe)". The renderer is the one process that holds every open brief, the layout, the app's
`localStorage` and the preload's `window.tyto`. A plugin's page shown there is third-party code
one frame away from all of it. ADR 0044 already runs an installed plugin's code in a
`utilityProcess`. A panel is the other half of the plugin: markup, a script and a place in the
window.

## Decision

### The page is a file, served by main, into `sandbox="allow-scripts"`

- **`PanelContribution` is data**: `{ id, title, location?, entry }`, with `entry` a path inside
  the plugin's folder. It crosses the worker boundary like `template-pack` does, and nothing in
  it is callable.
- **Main serves `tyto-plugin://<plugin>/<path>`** (`src/main/plugin-protocol.ts`), only for an
  active plugin that contributes a panel, and only a file `confinedPath` places inside that
  plugin's folder. Every segment is decoded and then judged, so `%2e%2e` is `..`. `.`, `..`, an
  empty segment, a drive, a colon, a NUL and an encoded `/` or `\` are refused. The rest is
  resolved through `realpath`, so a link or junction leading out of the folder is refused too.
- **Every page carries its own CSP**: its plugin's origin for scripts, styles, images and fonts;
  `connect-src 'none'`; no frames and no form target. A panel has no network of its own.
- **The iframe's sandbox is `allow-scripts`, exactly.** There is no `allow-same-origin`, so the
  page's origin is opaque: `window.parent.document` and `localStorage` both throw
  `SecurityError`. There is no `allow-popups`, `allow-top-navigation`, `allow-forms` or
  `allow-modals`. Electron runs no preload in a subframe, and `nodeIntegrationInSubFrames:
false` is written out rather than left as the default, so `window.tyto` is `undefined` inside
  the page. The e2e asserts all of this in the running window.

### Two layers keep the frame where it is

1. **The window's CSP**, `frame-src 'self' tyto-plugin:`. A panel that sets
   `location = 'https://example.com'` is stopped here, before main is asked, and the frame shows
   Chromium's error page.
2. **Main's guard**, `will-frame-navigate` with `frameNavigationAllowed`. A frame showing plugin
   `x` may move only within `x`. This layer is what refuses a navigation the CSP allows: another
   plugin's page is a `tyto-plugin:` URL.

**Neither layer replaces the other.** The guard is not redundant because the CSP stops
`https:`. The CSP is a string in `index.html` that any card may widen, and the guard still holds
when it does. The e2e proves the guard with another plugin's page, and uses in-plugin navigation
as the control.

### The bridge carries the same permissions as the plugin

A page asks through `postMessage`:
`{ tyto: 'panel', type: 'request', id, capability: 'fetch' | 'credentials', args }`.

- The renderer accepts a message only from one of the panels' own iframes. It checks the shape
  with a strict schema, so a page cannot name another panel.
- It relays the request on `panel:request` under the **element's** panel id.
- Main answers through `checkedCapabilities`, against the manifest the host validated, exactly
  as it answers the plugin's `host.fetch` and `host.credentials` (ADR 0042). A panel gets no
  permission its plugin was not granted.
- A refusal is data (`{ ok: false, code: 'E_PERMISSION' }`), posted back to that frame.

### The page hears the open brief, and that is disclosed

On each pause in typing, the same moment the preview compiles, every open panel receives
`{ type: 'event', event: 'document', text }`. **That is the document's text leaving the editor
for the plugin's code, with no permission asked.** It is stated here and on the plugins screen's
row for every plugin that contributes a panel (`plugins.panel.readsDocument`). A permission for
it is not introduced now: a panel is installed like the rest of its plugin, and the install
prompt already says a plugin has Tyto's access to the computer (ADR 0041).

### In the layout

A plugin panel's id is `plugin:<plugin>/<panel>`. The prefix keeps it from ever colliding with a
built-in's record. `layoutFrom` keeps a remembered plugin panel through a restart, with its
element taken from this build. `withPluginPanels` adds an offered panel **closed**, in the dock
it asked for, and drops one nobody offers any more. An older `layout.json` still parses. The
bottom dock lays its panels side by side: stacked in the problems panel's 140 px, two panels left
a line each.

## Consequences

- A plugin can put its own page in the window. That page cannot read the app, reach the network
  itself, open windows or navigate away, and it asks the host only for what its manifest was
  granted.
- Every plugin with a panel sees the open brief's text. A per-plugin opt-in would need a new
  permission and a place to grant it, which is not built.
- `panelPolicy` allows `'unsafe-inline'` styles and not inline scripts. A panel ships its script
  as a file.
- A panel's `fetch` answer carries the body as text, not bytes.
