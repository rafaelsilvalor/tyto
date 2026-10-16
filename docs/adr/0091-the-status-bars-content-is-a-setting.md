# 0091 — The status bar's content is a setting, and today's bar is the default

Status: accepted · 2026-10-15 · TYTO-301 · amends ADR 0076 · amended 2026-10-15 (the bar's
colours, `statusBarColors`) · amended 2026-10-16 (vim's mode style, `vimModeStyle`)

## Context

ADR 0076 fixes what the status bar holds: on the left the left-area button, the command bar
button and, while vim is on, its mode and pending keys; on the right Ln/Col with the selection,
the tab's kind, the brief's template, then the problems, queue, plugins, export and settings
buttons and the bottom and right area buttons. Nothing about it was a setting. Rafael asked on
2026-10-15 (TYTO-301) for the bar to be configured on its own, starting with which items show
and in what order. Its colours (`statusBarColors`) and the vim badge's style are later pull
requests of the same card and are not decided here.

## Decision

**`statusBarItems` is a list of item ids.** Thirteen ids, one per thing the bar draws:
`leftArea`, `commandBar`, `vimMode`, `cursorPosition`, `tabKind`, `template`, `problems`,
`queue`, `plugins`, `export`, `settings`, `bottomArea`, `rightArea` — camelCase like every
built-in key (ADR 0073), and named for what the item is rather than for its command, since
three of them run none. The list says which items show; an item it leaves out is not drawn.
`vimMode` and its pending keys are one item, because pending keys mean nothing without the
mode beside them.

**Each id keeps its home side; the list orders items inside it.** The first three live on the
left, the other ten on the right, as in ADR 0076. A list that names `settings` before
`cursorPosition` puts the settings button first on the right; it never moves an item to the
other side. Moving items across would make the setting a layout editor, which the card does not
ask for, and would leave the two sides' meanings — where you are, what you can open — to chance.

**Absent, the setting is today's bar exactly.** Its default is the thirteen ids in ADR 0076's
order. An item still shows only when it has something to show: vim's mode while vim is on, the
template when a brief names one, the position when the tab has a caret, an area's button when a
panel lives in that area. The setting filters on top of those rules and changes none of them.
`[]` is a valid value and empties the bar.

**A bad entry costs itself, not the list.** The `configuration` extension point (ADR 0073) gains
`entries` on a contribution: a schema each entry of a list is checked against alone, and whether
entries must be unique. An unknown id, a value that is not a string, or an id the list already
named is `W_SETTING_ENTRY_INVALID` — a new warning — at that entry's own range (the JSONC reader
now records each array element's range, `SettingEntry.entryRanges`), the entry is left out, and
the rest apply. A value that is not a list is still `W_SETTING_INVALID` at the value and the
default bar applies. The mechanism is generic: any plugin's list setting can use it.

**The options are in the file.** The schema is an enum of the thirteen ids, each with a sentence
(`STATUS_BAR_ITEMS` in `shared/status-bar-items.ts`), and the description lists them. A
`settings.json` that "Open Settings (JSON)" creates carries the key commented out with every id,
its side and its sentence, so a person sees every option without opening a document. The
settings tab has no completion or hover yet; when it gets them, the same table feeds them.

**Live on save, through the theme answer.** `statusBarItems` travels on `theme:current`'s
answer beside `iconStrokeWidth`, which the window already asks for on every `settings:changed`,
so no channel is added: main keeps the value in force, a save of the file moves it, and the
window repaints the bar.

**An item a later version adds enters at the end of its side, with a note.** A person whose list
was written before an item existed did not leave that item out on purpose. When a version adds
one, a list that does not name it shows it at the end of its home side, and that version's
release note says so; naming it in the list places it, leaving it out of a list written after
that version hides it. This needs the set of ids a list could have known, which the version that
adds the first new item introduces with it — today every id is original, so the rule has no
case yet and no code.

## Amendment, 2026-10-15: the bar's colours are a setting too

**`statusBarColors` is one object of colours that win over the theme**, like VS Code's
`workbench.colorCustomizations`, and **one for every theme**: no section per theme, because a
person who wants a navy bar wants it whichever theme is in front, and per-theme sections would
be a second theme format. Twenty-three keys, camelCase with a dot for a group:

- the bar's own: `background` and `foreground` (the theme's `status-bar` and `status-bar-text`),
  `itemHoverBackground`, `itemHoverForeground`, `itemActiveBackground`, `itemActiveForeground`
  (a button under the pointer and a toggle that is on; without the setting they read the
  chrome's `hover`, `button-on` and `text`, as before);
- vim's badges: `vimMode.normal`, `vimMode.insert`, `vimMode.visual`, `vimMode.replace` (visual
  line and block wear visual's, as with the theme's tokens, ADR 0089 decision 8);
- one text colour per item: `item.<id>` for each of the thirteen ids above. A per-item colour
  exists only here; no theme token carries one, so no theme has to set thirteen more. `item.vimMode`
  colours the pending keys; the badge is the `vimMode.*` keys'.

The hover and on-state colours are properties of the bar (`--status-bar-hover` and the like)
with the theme's tokens as their fallback in `shell.css`, not theme tokens: a theme token would
oblige every distributed theme to set it (ADR 0089 decision 3).

**A colour is `#rgb` or `#rrggbb`, opaque.** Only an opaque colour has a contrast to measure,
and hex is the one spelling the window can write into its sheet with nothing to escape.

**Each member costs itself.** The `configuration` point gains `members` beside `entries`: a
schema for a member's name and one for its value. An unknown name is `W_SETTING_ENTRY_INVALID`
at the name, and its message lists every key; a value that is not a colour is
`W_SETTING_INVALID` at the value, under the dotted key (`statusBarColors.background`). Either is
left out — the theme's colour applies there — and the rest apply. The JSONC reader records each
member's ranges (`SettingEntry.memberRanges`). A value that is not an object is still
`W_SETTING_INVALID` and no colour is overridden.

**A vim badge's text is chosen as the theme's own is**: the best-reading of the theme's
`surface`, `text` and `accent-text` on the person's colour, per theme, so one override reads in
light and dark alike. When none reaches 4.5:1 the colour **still applies** — the person chose it
— and the settings tab says so at the value with the new warning `W_SETTING_LOW_CONTRAST`, which
names the ratio measured (rounded down, so it never reads as passing) and the theme. It is
measured against the themes the mode can show: the light one, the dark one, or both under
`system`.

**The bar's own pair is measured too** (Rafael, 2026-10-15, after the pictures showed
`background` `#1e3a5f` alone leaving Tyto Light's bar text at **1.62:1**). When the override
sets `background`, `foreground` or both, the pair in effect — the override where it is set,
the theme's `status-bar` / `status-bar-text` where it is not — is held to 4.5:1 in the same
themes as the badges. Under it the colours still apply, and `W_SETTING_LOW_CONTRAST` sits on
`foreground` when that is set (the colour a person reads), else on `background`, with the
ratio and the theme. The per-item and hover/on colours are not measured: they are the person's
to pair.

**Live on save, through the same answer.** The value travels on `theme:current` beside
`statusBarItems`; the window writes it into the theme sheet after each mode's colours, on
`.shell__foot` (and each item's colour on that item), so a save repaints the bar, and removing
the key gives the theme's colours back. No channel is added.

**The options are in the file.** A new `settings.json` carries `statusBarColors` commented out
with every key, an example colour and what it paints; the setting's description lists them too.

## Amendment, 2026-10-16: how vim's mode is shown is a setting

**`vimModeStyle` is one of three words**, each drawing vim's mode in the mode's colour — the
theme's `status-bar-vim-<mode>`, or `statusBarColors`' `vimMode.<mode>` over it:

- `badge`, **the default**, the look before the setting: only the mode's name is coloured;
- `border`: the bar keeps its colours (the theme's, or `background`/`foreground` over them) and
  a strip of 2 px (`--tyto-status-bar-vim-strip`) along its top edge takes the mode's colour;
  the mode's name is plain text in the item's colour;
- `bar`: the whole bar takes the mode's colour, **over `statusBarColors.background`**, and its
  text and icons take a colour chosen for it as a badge's text is: the best-reading of the
  theme's `surface`, `text` and `accent-text` on that colour, per theme. The mode's name is
  plain text on the coloured bar. `item.<id>` colours still win over that text and are still
  not measured.

With vim off every style draws the plain bar: the window sets `data-vim-mode` on the bar only
while vim is on, and the border and the bar are drawn from it and `data-vim-style`.

**The bar's text reads 4.5:1 in every theme Tyto ships.** `src/main/vim-mode-style.test.ts`
measures the text `bar` writes on each of the four mode colours of the 22 themes; the lowest of
the 88 is **4.501:1**, Gruvbox Dark's REPLACE (`#282828` on `#fb533f`), the floor the
badge already met. A `vimMode.*` override is chosen for and warned about as before: the badge's
check is the bar's, because the text is chosen by the same rule, so `W_SETTING_LOW_CONTRAST`
sits at the value under `badge` and `bar` alike. Under `border` no text sits on the mode's
colour, only the strip, and **the warning is not given**.

**Hover and on stay readable on a coloured bar**: a hovered button keeps the theme's opaque
`hover` with `text`, and a toggle that is on takes `surface` with `text` (`itemHover*` and
`itemActive*` still win over both). `button-on` is a translucent grey, which on a mode's colour
would leave `text` on a tinted mode colour, so it is not used there. Both pairs are ones the
theme's own floors already hold readable, and both stand apart from every mode colour: the
closest of the 176 pairs in the 22 themes is ΔE2000 **27.1** (Tokyo Night's `surface` on its
NORMAL). On the coloured bar the error count, the "new" dot and the
focus ring take the bar's text, since the theme's error, accent and focus colours are the
mode colours replace and normal wear.

**Live on save, through the same answer**, as `statusBarItems` and `statusBarColors`: the value
rides on `theme:current`, and the theme sheet writes the bar's text for each mode under `bar`.
A new `settings.json` carries the key commented out with the three values and what each does,
and the setting's description says the same, value by value; a word that is not one of the
three is `W_SETTING_INVALID` at the value, naming them, and the badge applies.

## Consequences

- `plugin-api`: `ConfigurationContribution.entries` and `SettingEntry.entryRanges`, both
  optional, so every existing contribution and reader is unchanged. A minor version.
- `core`: one code, `W_SETTING_ENTRY_INVALID`, a warning, never fatal.
- `apps/desktop`: the seventh built-in setting; `status-bar.ts` draws from the list.
- `plugin-api`: `ConfigurationContribution.members` and `SettingEntry.memberRanges` (amendment),
  both optional. `core`: `W_SETTING_LOW_CONTRAST`, a warning.
- `apps/desktop` (amendment of 2026-10-16): the ninth built-in setting, `vimModeStyle`.
- Not done here: dragging items, a plugin's
  own status items (when they arrive they get ids in the same list, prefixed by plugin id as
  their settings are), and completion or hover in the settings tab.
