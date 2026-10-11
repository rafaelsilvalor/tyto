# 0078 — The window draws its own title bar and keeps the system's buttons

Status: accepted · 2026-10-11 · TYTO-244 · builds on ADR 0024, ADR 0074, ADR 0075 and ADR 0077

## Context

Until this ADR the window used the system's frame on every platform: a title bar painted by the
operating system, the native menu bar under it on Windows and Linux, and then the app's own
header, `<header class="shell__head">`, with the app's name and a tagline — a third strip before
the first tab (about 27 px since TYTO-96). Rafael asked on 2026-10-08 for the Zed arrangement: a
thin bar the app draws, with the menu in it. ADR 0024 decided the renderer and the layout, ADR
0075 the look; neither decided the frame, so this one does.

The card ships in two pull requests and this ADR covers both. PR A is the frame and the title
bar; PR B is the menu row drawn in that bar. Rafael answered the taste questions on 2026-10-10
and 2026-10-11, and the coordinator declared the rest.

## Decision

**1. Windows and Linux hide the system's title bar and keep its buttons.** `titleBarStyle:
'hidden'` with `titleBarOverlay { color, symbolColor, height: 32 }`: minimise, maximise and close
are the system's own buttons, drawn over the right end of a bar the page draws. Snapping,
double-click to maximise and the accessibility of those three buttons stay the system's. The
options are `frameOptions` in `src/main/title-bar.ts`, a pure function a unit test reads.

**2. macOS does not change in this card.** The traffic lights, the native menu bar and the
native title stay, and `frameOptions('darwin')` is empty. Nobody can look at a Mac before the next
tag, and a frame change nobody has seen is how a window ends up with two titles or none. The
drawn bar is hidden there by `shell.css` from `data-platform` on the root element, which the
window sets from `app:info`.

**3. The bar says "Tyto — <file>"** (Rafael): the app and the name of the file in the active
tab, "Tyto" alone for a tab in no file, and the settings and keybindings tabs by their file's
name, as the tab strip names them. **No unsaved marker**: the tab carries the dot, and the same
fact a few pixels above it would be noise. `titleBarText` in `src/renderer/shell.ts`, written by
`paintTitle`, so the bar moves on every call the window's `<title>` already moves on. The
`<title>` itself is unchanged — it still names the file and says _unsaved_ in words — because
the taskbar and a screen reader read it, and the drawn bar is neither.

**4. The header goes, and the tagline with it** (Rafael). Not to About either: `app.tagline` is
removed from the catalogue, and nothing else used it. `app.name` stays — the drawn bar, the
`<title>`, the About box and the crash box all use it.

**5. The bar drags the window, and what is clicked in it does not.** `-webkit-app-region: drag`
on `.title-bar`, `no-drag` on the place reserved for the menu row. The part of the bar the
overlay leaves free is `env(titlebar-area-x/width/height)`, so no title runs under the buttons;
the fallbacks are a window with no overlay.

**6. The buttons follow the theme, and only from tokens.** The overlay's colour is the applied
theme's `surface-raised` — the bar's own background — and its glyphs are `text`. Main paints it
with `setTitleBarOverlay` every time it answers the window about themes (`theme:current`,
`theme:preview`, `theme:choose`), when the `theme` setting is saved, and on `nativeTheme`'s
`updated` (the system flipping between light and dark). Until the window first asks, the base
theme of the kind on show, which is what `tokens.css` paints first too. **Only hex reaches the
overlay**: a theme may write `rgb()`, `hsl()` or `color-mix()` (ADR 0077) and the page resolves
them, but the overlay is parsed by Electron, so a colour that is not hex falls back to the base
theme's, one colour at a time, and the alpha of an 8-digit hex is dropped. On the built-in
themes the buttons and the bar are the same colour exactly. No new IPC channel: the window does
not tell main anything it did not already ask.

**7. The native application menu stays installed, from the same template.** It is no longer
drawn on Windows and Linux (measured below), but it is still what carries the role
accelerators — measured: `Ctrl+Shift+I` sent through `webContents.sendInputEvent` opened the
developer tools with the title bar hidden as it did with the native frame — and it is what
`getApplicationMenu()` reads in the end-to-end suites that prove Reload and Close did not come
back (TYTO-104). Not installing a menu at all would put Electron's default one back, with the
two accelerators `menu.ts` exists to remove.

**8. PR B, decided now.** A menu row in the bar's reserved place: the five names in a row —
File, Edit, View, Window, Help — each opening the **native** popup list of that submenu with
`Menu.popup`, which does not follow the theme. Main sends the model (`menu:model`) and the
window asks it to run an item or open a submenu (`menu:invoke`). Alt and F10 are bindings in the
window's own dispatcher (ADR 0074), never menu accelerators (TYTO-124). ARIA `menubar` semantics.

## What was measured

Electron 44.4.5 on Windows 11, the built app, its own `--user-data-dir` and `TYTO_HOME`, at
900x600, captured with `PrintWindow` from the window's own handle:

- **With the title bar hidden the native menu bar is gone, and nothing brings it back.**
  `isMenuBarVisible()` is `false` at launch, after a real Alt press sent to the window with
  `keybd_event`, after an Alt sent with `sendInputEvent`, and after `setMenuBarVisibility(true)`;
  the captures show no menu row. The control — the same build with `frameOptions` returning
  nothing — shows the menu bar at launch and `isMenuBarVisible()` `true`, and the Alt press
  highlights _File_. So there is no double menu and no keyboard path either: **between PR A and
  PR B the menu is unreachable on Windows and Linux.** Every File item is a command in the
  command bar; Quit is the close button; Help ▸ _Open the log folder_ and Help ▸ _About_ have no
  other door. PR B closes that, and a release between the two would ship without them.
- `navigator.windowControlsOverlay.visible` is `true` and its title bar area is 764x32 at a
  902-wide window: the overlay's buttons take 138 px at the right.
- Playwright's `capturePage` and CDP screenshots draw the page and not the overlay, so the
  buttons are visible only in a `PrintWindow` capture.

## Consequences

- `src/main/title-bar.ts` (`frameOptions`, `titleBarOverlay`, `overlayColour`, `overlayFor`,
  `TITLE_BAR_HEIGHT`) and its unit test; `window.ts` takes a `frame`; `index.ts` keeps the last
  applied themes and paints the overlay.
- `index.html` loses the header and gains `.title-bar`; `shell.ts` gains `titleBarText`.
- `e2e/title-bar.desktop.test.ts` reads the bar's text across tabs, the header's absence, the
  overlay main asked for when the system flips — by wrapping `setTitleBarOverlay` on the window
  from `app.evaluate`, because Electron has no getter for it — and the menu still carrying no
  Reload and no Close.
- The window is 32 px of chrome at the top on Windows and Linux where it was the system's title
  bar, the menu bar and the 27 px header.
- Not decided here: whether the bar shows more than the title later (a project name, a branch),
  and the macOS frame, which waits for somebody who can look at a Mac.
