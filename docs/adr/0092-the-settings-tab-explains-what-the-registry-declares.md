# 0092 — The settings tab explains what the registry declares, from an outline main derives

Status: accepted · 2026-10-16 · TYTO-304 · amends ADR 0091 (its "not done here" line)

## Context

The `settings.json` tab (ADR 0073) had no completion and no hover. A person found a setting's
accepted values in two places: the commented example a newly created file carries, and the
message of a diagnostic after typing something wrong. A file that already exists — every
installed copy — never gains the example of a setting added later. ADR 0091 said that when the
tab got completion and hover, the same tables that write the example would feed them.

Four facts shaped the answer, measured on `main` before the card. The window has no schema: the
tab's diagnostics come from main on `settings:validate`, and `theme:current` carries only the
values in force. The schemas are Zod, which is code and cannot cross a process boundary. The
`theme` setting's ids are checked by a lookup at validation time, not listed in its schema. And
an installed plugin cannot declare a setting yet (`registerConfiguration` is in
`NOT_YET_ISOLATED`), so "a plugin's setting is suggested" can only be shown in process today.

## Decision

**Main derives an outline, and the window asks for it once.** `outlineOf(declared)` in
`@tyto/plugin-api` reads each declared schema with Zod 4's own `z.toJSONSchema`
(`unrepresentable: 'any'`, no new dependency) and answers plain data per key: the description,
a type in words, the default as JSON, and the values the setting, one list entry
(`entries.options`) or one object member (`members.options`) may take. `settings:outline` is a
new read-only channel with no subject, in the three lists (`shared/ipc.test.ts`, its no-subject
list, `e2e/window.desktop.test.ts`), with a bounded response schema. Main waits for the
installed plugins, as `theme:list` does, and fills `theme`'s values from the registered themes.
The window asks after it loads; the tab reads the answer each time a list or a tooltip opens, so
a tab opened before the answer arrived gets the help too.

**The outline is derived data, not a lifting of `NOT_YET_ISOLATED`.** Nothing about how a
setting is declared or checked changes: the schema in main still decides, through
`settings:validate`, and the outline only says what the schema accepts. An outline that says
less than the schema costs a suggestion, never a value. When isolated plugins can declare
settings, their declarations join the registry and reach the outline by the same road.

**Plugins may say what each value does: `options`.** `ConfigurationContribution` gains an
optional `options: { value, description }[]`, and `entries` and `members` each gain one too — a
minor version of `@tyto/plugin-api`. They are help: suggested and listed on hover, never a rule.
An option the setting's own schema refuses makes the declaration throw, as a default the schema
refuses already does, because a suggestion that writes a warning is the plugin's bug. Without
them, an enum's values and a boolean's two come from the schema with no sentence. The desktop
fills them from the three tables that write the commented example (`VIM_MODE_STYLES`,
`STATUS_BAR_ITEMS`, `STATUS_BAR_COLOUR_KEYS`), so the file's example, the refusal messages and
the tab's help have one source.

**Hover arrives in the editor, which still knows no settings.** `@tyto/editor` exports
`jsonAssist(source)`: the host answers two questions about a text and a position — what can go
here, what is this — with plain data, and the editor turns the answers into CodeMirror's
completion list on the JSON language's data facet and a `hoverTooltip`. It is the first hover in
the editor. The path at the cursor is read with `jsonc-parser`'s `getLocation` in the
renderer's `settings-assist.ts`, a pure module. A tab gets the help through a third argument of
`EditorHandle.blank` — the document's own extensions — chosen by `assistOf(kind)` beside
`languageOf(kind)`, so a tab opened by its command and one restored by the session are built the
same; a follower in a second group is built from the document's state and carries them.

**What is suggested.** A key not yet written, with its description and its default; picking it
writes `"key": <default>` with the default selected, as VS Code does, and a comma when another
key follows. A setting's values with their descriptions, booleans included. A `statusBarItems`
id not already in the list. A `statusBarColors` member name not already in the object, with an
empty colour and the caret between its quotes. A `theme` id from the registered themes. Hover on
a key shows its description, type, default and accepted values; on a member name, what it
paints. For a setting whose entries or members carry options (`statusBarItems`,
`statusBarColors`) the hover shows the description's first sentence, the type and the default,
then each option once, `name — sentence`, one per line: those descriptions list the options in
prose for the messages, and both together ran to thirty lines (Rafael's call, 2026-10-16). The
descriptions themselves are untouched. The tooltip is capped at 60% of the window's height and
scrolls. The descriptions stay English, one source; the hover's three labels go through the
catalogue. The existing diagnostics are unchanged, and lint and hover tooltips coexist. With vim
on, the list works in insert mode; no key is bound beyond CodeMirror's own completion keymap,
which a brief tab already has.

## Consequences

- `plugin-api`: `options` on `ConfigurationContribution`, `entries` and `members`; `SettingOption`,
  `SettingOutline` and `outlineOf` exported. A minor version.
- `editor`: `jsonAssist` and its four types; `blank` takes a third argument. A minor version.
- `apps/desktop`: `settings:outline`, `settings-outline.ts` in main, `settings-assist.ts` and
  `assistOf` in the renderer, three catalogue keys.
- `keybindings.json` gets its own source through the same `jsonAssist` door in a second pull
  request of TYTO-304: command ids with their titles, and the closed set of contexts.
- Not done here: suggestions inside `theme`'s `{ mode, light, dark }` form, and in `queueKinds`;
  a setting's description translated; a settings screen with controls (still a text file, with
  help).
