# 0099 — Typography is two bases and a closed set of areas; the zoom belongs to Electron

Status: accepted · 2026-10-17 · TYTO-272 (PR A; amended 2026-10-18, PR B) · builds on ADR 0073
(settings), ADR 0075 (the token file) and ADR 0077 decision 10 (fonts are not theme data)

## Context

Every size in the window was a pixel literal in `tokens.css` — `--tyto-text-xs` 12 px to
`--tyto-text-lg` 16 px — and the editor inherited the body's 14 px. The faces were the two Tyto
ships, Source Sans 3 and IBM Plex Mono (ADR 0075, TYTO-269). A person who reads better at 18 px,
or who has a code face they like, had no door, and View > Zoom In was Electron's `zoomIn` role:
a level that lived only in the running window, on an accelerator the browser process answered
before the page.

ADR 0077 decision 10 put fonts outside the theme: a colour theme assigns colours, and a face is
a dependency question. So the type is the person's settings, not a theme's tokens.

## Decision

**1. Two bases, and every size derives from one of them.** `uiFontSize` (9–24, default 14) is
`--tyto-ui-size`, the window's text outside the editor; `codeFontSize` (9–32, default 14) is
`--tyto-code-size`, every CodeMirror buffer's — briefs, the JSON tabs and the template buffers,
and what CodeMirror draws inside the editor without a size of its own (the gutter, the pinned
head lines, the completion list). The ramp is the UI base times its old ratio to 14, rounded to a
pixel: `round(calc(var(--tyto-ui-size) * 12 / 14), 1px)` for `--tyto-text-xs`, 13 and 16 for
`-sm` and `-lg`, `-md` the base itself. **At the defaults every size is the pixel it was** — 217
of 217 elements' computed size, line height, face and box identical before and after, in a
window with a brief and its preview open, and the screenshots identical but for the blinking
caret.

**2. The areas are a closed set, and they come next.** PR B of the card adds `fontSizes` and
`fontFamilies`, objects keyed by a fixed list of areas (status bar, tabs, panels, preview bar…),
each over its base. That is why the window is told one `typography` object on `theme:current`
and not four loose values, and why the areas are a list the app declares rather than selectors a
person writes: a selector is a contract with the markup, and the markup is free to change.

**3. A face is the person's name followed by the bundled one.** `uiFontFamily` (default Source
Sans 3) and `codeFontFamily` (default IBM Plex Mono) go into `--tyto-font-ui` and
`--tyto-font-mono` as `"<name>", 'Source Sans 3'` and `"<name>", 'IBM Plex Mono', monospace`, so a
name the machine lacks falls through to the face Tyto ships, never to the browser's default. The
schema refuses quotes, a backslash and `; { } < >`, so a name cannot close the CSS string it is
written into; the bridge checks it again.

**4. A face the machine lacks is said, not refused.** The window measures a sample in the face
with each of `monospace`, `serif` and `sans-serif` behind it against the generic alone; a face
that is not there measures as the generic under all three. Then `W_FONT_FAMILY_MISSING` is a row
in the problems panel naming the setting and the face. **Minted in the window and not in main**,
because only the renderer can ask the browser which faces it draws: main can list font files by
name (ADR 0037's reader), and that misses Consolas, whose file is `consola.ttf`. The cost is that
the row has no range in `settings.json`; the setting's name is in the message instead.

**5. The strips' heights are floors.** `--tyto-pane-strip-height` (30) and
`--tyto-pane-header-height` (22) stay the pixels the pane shape is measured in, and
`--tyto-pane-strip-block` / `--tyto-pane-header-block` are `max()` of that and the label's line
plus its padding. At the defaults the line is shorter (26.85, 21.4) and nothing moves; at 18 the
strip is 32.65 and the header 25.75, and no label is cut. The title bar stays the system
buttons' height: at 24 its 22 px text is a 31.9 px line in a 32 px bar.

**6. CodeMirror is told to measure its text again.** It watches no custom property, and it
re-reads the character width only when it meets a line height it has not seen — so a new face
at the same size kept the old width, and the indent guides drifted 2 px off their second level
(Consolas for IBM Plex Mono at 20 px, measured). `remeasureText` sets CodeMirror's own internal
`mustMeasureContent = "refresh"` — the door it opens itself when the document's fonts load —
asks for a measure, and once it has run sends a `textRemeasured` effect, on which the guides and
the pinned head lines redraw. `remeasure.test.ts` fails the day an upgrade renames the internal.

**7. The zoom belongs to Electron.** `zoom` (−5 to 5, default 0) is `webContents.setZoomLevel`, a
factor of 1.2 per step, applied by main at launch, at every page load and on a save; it scales the
window and the preview's art alike, which is what Ctrl and + means in every browser and in VS
Code. It is not on `theme:current`. The system's title bar buttons are sized in the window's
pixels, so `setTitleBarOverlay` gets `32 × 1.2ⁿ` and the page's bar stays 32 of its own. A
capture window for an export is a separate page and keeps level 0 (measured).

**8. Zoom In, Zoom Out and Reset Zoom are commands, and each one writes the setting.** The three
roles left the View menu for `window.zoomIn`, `window.zoomOut` and `window.zoomReset`, bound to
`Mod-=`, `Mod--` and `Mod-0` in the window's table as global bindings — they answer in vim, in a
preview and in the settings tab, and the keys are free in the table, in CodeMirror's keymaps and
in vim's engine. A press goes to main on one new channel, `window:zoom`, which steps the setting
inside its bounds, applies it and writes it through the settings store as a screen's change, as
VS Code does: every zoom a person makes is in the file they can read. A file that does not parse
refuses the write and the zoom goes back.

**9. What cannot follow.** The native menus' and dialogs' text is the system's, and Electron has
no way to give them a face or a size; the menu row Tyto draws (ADR 0078) follows the ramp. The
preview's art is not typography — it is the template's — and only the zoom scales it.

## Consequences

- Five new settings, each with options and a description for the settings tab, commented in a
  new `settings.json`. No new theme token: the 42 colours are unchanged.
- One new IPC channel, `window:zoom`, for the write a keystroke has to reach main for. The fonts
  apply on `theme:current` like the editor's other settings.
- Ctrl and the mouse wheel do not zoom; Electron reports it (`zoom-changed`) and nothing listens.
  VS Code makes it a setting; it can be one here when somebody asks.
- `Mod-+` (Ctrl, Shift and =) is not bound: `Mod-=` is.

## Amendment of 2026-10-18 — the areas (TYTO-272 PR B)

Decision 2 named the areas and left them for PR B. This is what PR B built.

**1. Eleven areas, each over one base.** `editor` (briefs and the template buffers), `json`
(the settings, keybindings and snippets tabs) and `completion` (the suggestion list) follow
the code base; `problems`, `commandBar`, `titleBar`, `tabs`, `paneHeaders` (the breadcrumb
row, a preview's bar and every tool header), `statusBar`, `queue` and `explorer` follow the UI
base. The list is `FONT_AREAS` in `shared/typography.ts`. `explorer` is declared for
TYTO-279 and has no root yet, so it changes nothing today.

**2. Two object settings with a closed set of keys**, through the configuration point's
`members` rule like `statusBarColors` (ADR 0091): `fontSizes` (`{ area: px }`, absolute
pixels) and `fontFamilies` (`{ area: face }`). A size is checked by its area's own bounds —
9 to 32 over the code base, 9 to 24 over the UI base, and 9 to 18 for `titleBar`, so its text
stays inside the system buttons' 32 px. That needed one change to `plugin-api`:
`members.schemaByName`, a schema per member name. An unknown area is
`W_SETTING_ENTRY_INVALID` at its name and a size or face out of bounds `W_SETTING_INVALID` at
the value, and the rest apply. A face the machine lacks is `W_FONT_FAMILY_MISSING` naming
`fontFamilies.<area>`. Both ride on `theme:current` inside the same `typography` object, so
there is no new channel.

**3. An unset area follows its base, and setting the base still moves it.** The theme sheet
writes nothing while neither setting has a member. Once one does, it writes a rule for
**every** area, an unset one at its base's value. Areas nest — the completion list sits
inside the editor, a panel's header inside the panel — and an area that wrote nothing would
read the area around it instead of its base.

**4. The mechanism is an attribute and redeclared properties.** Each area's root carries
`data-font-area="<id>"`, and the rule there sets the base's properties (`--tyto-ui-size` or
`--tyto-code-size`, `--tyto-font-ui` or `--tyto-font-mono`). A custom property is substituted
where it is declared, so the ramp (`--tyto-text-xs`…`-lg`) and the strip heights
(`--tyto-pane-strip-block`, `-header-block`) are declared on `:root, [data-font-area]` in
`tokens.css`: inside an area they are computed from the area's own size. A UI area's root
re-reads the face and `--tyto-text-md` at no specificity (`shell.css`), for text with no rule
of its own. The completion list is CodeMirror's tooltip and cannot be given an attribute, so
its rule also names `.cm-tooltip.cm-tooltip-autocomplete`, and `@tyto/editor` makes the list
read `--tyto-code-size` itself. One CodeMirror view shows briefs and JSON tabs alike, so a
group's mount changes area with the tab in front, and measures its text again when it does
(decision 6).

**5. The strips keep their floors, per area.** With `tabs` at 18 an editor group's strip is
32.65 px and a tool header beside it stays 30, so their bottoms no longer meet across the
window. That is the price of sizing the two apart; setting the UI base moves both together.

**6. At the defaults the window is the window PR A left.** 210 of 210 elements had the same
computed size, line height, face and box before and after, in a window with a brief, its
preview, a settings tab, the queue and problems panels and the command bar open.
