# 0091 — The status bar's content is a setting, and today's bar is the default

Status: accepted · 2026-10-15 · TYTO-301 · amends ADR 0076

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

## Consequences

- `plugin-api`: `ConfigurationContribution.entries` and `SettingEntry.entryRanges`, both
  optional, so every existing contribution and reader is unchanged. A minor version.
- `core`: one code, `W_SETTING_ENTRY_INVALID`, a warning, never fatal.
- `apps/desktop`: the seventh built-in setting; `status-bar.ts` draws from the list.
- Not done here: colours (`statusBarColors`), the vim badge's style, dragging items, a plugin's
  own status items (when they arrive they get ids in the same list, prefixed by plugin id as
  their settings are), and completion or hover in the settings tab.
