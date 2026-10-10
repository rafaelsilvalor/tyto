# 0076 — The status bar is one line of doors to commands, and an area hides whole

Status: accepted · 2026-10-10 · TYTO-248 · fills in the status bar ADR 0024 drew and left empty

## Context

ADR 0024 draws a status bar at the foot of the window and does not say what goes in it. Until
this ADR `footer.shell__foot` held a language picker and four program facts — version,
platform, template count, template folder — in a `flex-wrap: wrap` row, plus the update notice
(TYTO-131). Rafael asked for a bar in the manner of VS Code and Zed, and approved its icons and
its layout on 2026-10-08 (TYTO-96, comment 1291169). He answered the two taste questions on
2026-10-10: the area buttons hide the **whole** area, and the language picker leaves the window.

## Decision

**One line, never two.** `.shell__foot` is `nowrap`; what does not fit is the template's name,
which truncates with an ellipsis. Measured at 900x600 with the longest content the bar carries
(a long template name, a selection, the Portuguese "ready" update notice): 22.8 px, one row.
With `nowrap` removed the same window measures 38.5 px (`e2e/status-bar.desktop.test.ts`).

**Every button is a door to a command that exists by id**, the way the menu and the command bar
are: left area, command bar, then on the right problems (with its count inside the button),
queue, plugins, export, settings, bottom area, right area. The problems and queue buttons run
`layout.togglePanel:<id>`; plugins, export and settings run the commands their menu items run.
A button whose area or panel is on screen carries `--tyto-button-on`. Each has an `aria-label`
from the catalogue, in both languages. The facts beside them are vim's mode (only while vim is
on) and pending keys, Ln/Col with the selection size, the tab's kind, and the brief's template.
TYTO-143's "new problems" mark goes inside the problems button, beside the count.

**An area hides whole** (Rafael, as in VS Code and Zed). Three commands,
`layout.toggleDock:left|bottom|right`, in the registry and therefore in Ctrl+K and bindable in
`keybindings.json` through the ADR 0074 table; no default key is added. The state is
`hiddenDocks` in the layout record and in `layout.json` — layout, not a setting — optional, so
every file written before it still reads. Hiding leaves each panel's `open` as it was, so a dock
holding the queue and a plugin panel comes back with both. Showing an area that would be empty
opens its first panel, because a button that lit up over nothing would look broken; an area no
panel lives in is left as it is. Opening a panel inside a hidden area shows the area.

**The language picker leaves the window.** Switching is `shell.toggleLocale` in the command
bar, session-only as before. No setting is added.

**The program facts move to Help ▸ About.** A menu item with a click, not `role: 'about'`: the
facts are read when it opens (the template folder changes at runtime), and the role's panel on
Windows was measured, through UI Automation on the running app, to show a box titled with the
package name and the word "Tyto" and nothing else. So Windows and Linux get a message box with
the four lines; macOS gets its own about panel with them as credits. Encoding and line ending
are out: neither is measured yet (the card's "Not verified").

**Vim's mode comes from the library's public events.** `@tyto/editor` exposes `onVimStatus`
from `vim-mode-change`, `vim-keypress` and `vim-command-done`, and the desktop passes
`vimStatus: false`. Vim's `:` prompt and its notifications stay in the library's own panel:
reading them into the bar would mean reading `cm.state.dialog`, which is the library's internal
state and could change in any release. Measured on the way: the library adds its own status
line only to a view **born** in vim; the desktop always switches vim on later, so on `main` the
line never appeared — which is why Rafael saw none. `vimStatus: false` matters for a view born
in vim, and the unit test that holds it creates one.

## Consequences

The footer has two children, `<tyto-status-bar>` and `#update-notice`; `update-notice.ts` is
untouched. The catalogue loses `shell.language.label` and gains the bar's and About's keys,
all listed in the e2e's `NOT_ELEMENT_TEXT`. End-to-end suites that switched language through
`#locale` now go through the command bar.

Not done here: dragging the bar's items, hiding the bar itself, the encoding and line-ending
facts, and the TYTO-143 mark.
