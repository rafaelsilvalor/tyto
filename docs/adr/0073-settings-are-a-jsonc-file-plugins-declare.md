# 0073 — Settings are a JSONC file the person owns, and plugins declare its keys

Status: accepted · 2026-10-10 · TYTO-206

## Context

The desktop app remembers four preferences in `settings.json`, in the per-version data folder
(ADR 0032): `templatesFolder`, `queueFolder`, `queueAutoRun` and `queueKinds`. Until this ADR
the file was the app's alone:

- `apps/desktop/shared/settings.ts` validated the whole record as one Zod object. One bad value
  failed the object, and `settingsFrom` answered every default — a typo in `queueAutoRun` cost
  the person their templates folder. Only `queueKinds` had a `.catch` of its own.
- `settings-store.ts` wrote the whole merged record with `JSON.stringify`. A comment did not
  survive the next screen change, and a file that did not parse was read as defaults and then
  overwritten with them.
- `plugin-api` had `config(schema)` on the host and a raw configuration record keyed by plugin
  id, but no way for a plugin to declare a setting.

TYTO-206 asks for the mechanism VS Code and Zed have: a JSON-with-comments file the person opens
and edits by hand, validated while they type, with plugins declaring their own keys. It adds no
setting. It ships in two pull requests; this ADR covers both and PR A implements the mechanism.

## Decision

**1. A `configuration` extension point, built on the existing configuration record.** A
plugin calls `host.registerConfiguration({ id, schema, default, description })`. `id` is the
plugin's own key — letters and digits, no dot — and `schema` is Zod, because the settings it
has to describe already are Zod schemas, and a second vocabulary for the same rules would be
two declarations that drift. A default the plugin's own schema refuses is a bug in the plugin
and refuses activation. `resolveSettings` answers the values by key and **the same values by
plugin id**, which `InProcessHost.configure` hands to the record `config(schema)` already read:
a plugin that declared `fontSize` reads it with `host.config(z.object({ fontSize: … }))`.
**Built-in is a plugin**: the four keys are declared by a built-in plugin named `desktop`
through the same door, with no special case.

**2. Key names.** A built-in's keys are written as they are declared, so the four keep the
exact names every `settings.json` already uses — no rename, no migration. Every other plugin's
key is `<plugin id>.<key>`, and the host adds the prefix, so two plugins' `fontSize` never
collide. A third party's key written without its prefix is `W_SETTING_UNPREFIXED`, naming the
key it should be, and is not accepted under the short name: accepting both would make the short
name a second spelling that breaks the day a built-in claims it.

**3. Layers: defaults, then the user file.** Nothing else. A per-folder layer
(`.tyto/settings.json` beside a project, like `.vscode/settings.json`) is not built: no setting
today differs per project, and Tyto has no notion of an open project folder to anchor one to.
When one is needed it is a third list of entries passed to `resolveSettings` after the user
file's, resolved key by key under the same rule, with a narrower set of keys it may set.

**4. Precedence.** The user file wins over the plugin's default. The default declared with the
setting is the only default; there is no second one in the store.

**5. Reading is tolerant per key and never fails.** Each key is validated alone. A value the
schema refuses costs that key, which takes its default, and is `W_SETTING_INVALID` with the
value's range. A key nobody declared is `W_SETTING_UNKNOWN` at the key. A syntax error is
`E_SETTINGS_SYNTAX`; the keys the parser recovered around it still apply. Every one is a
`Diagnostic` with a source `range`, so the second pull request can show them in the problems
panel where they were typed. Until then main writes them to the log.

**6. The format is JSONC, read and written with `jsonc-parser`** — a new runtime dependency of
`apps/desktop` (3.3.1, already in the lockfile through another package). It gives the two things
`JSON.parse` cannot: the range of every key and value for a diagnostic, and `modify` plus
`applyEdits`, which change one property and leave every comment, blank line and indentation the
person chose. The alternative, a hand-written comment-stripping reader, was rejected: it gives
neither, and stripping comments to parse means writing back a file without them. A screen's
change goes through the same store and edits the file in place, writing only the keys it
changed; a key set back to its default is removed, so the file holds what the person chose and
not a dump of what the app assumes. **The file is never written while it does not parse**: the
write is refused, answered with the syntax diagnostics and logged, and the file stays byte for
byte what the person left.

**7. Location: unchanged.** The file stays in the per-version folder (ADR 0032). Moving it to a
version-independent folder would make two installed versions share a file whose keys only one
of them may know, which ADR 0032 exists to avoid. The previous version's settings still arrive
through the offer of ADR 0036, which copies `settings.json` byte for byte and now checks it
with the JSONC parser, so a comment is not mistaken for corruption.

**8. Three writers, for the second pull request.** Once the file opens in an editor tab there
are three writers: the app's screens, the open tab, and the file watcher that applies a save.
When the settings tab is open with unsaved changes, a screen's change is applied to the tab's
buffer instead of the disk, so the person's unsaved typing is neither overwritten nor
overwrites the screen's change on save. The watcher ignores the app's own write by comparing
the content hash of the last text the app wrote. PR A states this; PR B builds it.

## Consequences

- `plugin-api` gains a contribution point (`configuration`, the eleventh), `registerConfiguration`,
  `registry.configurations()`, `InProcessHost.configure` and `resolveSettings`. A minor version.
- **An isolated plugin cannot declare a setting yet**: a Zod schema is code and does not cross
  to the plugin's process, so `registerConfiguration` is refused by name there, like `source`.
  Lifting that needs a data form of a schema the host can validate against.
- `core` gains four codes: `E_SETTINGS_SYNTAX`, `W_SETTING_UNKNOWN`, `W_SETTING_UNPREFIXED`,
  `W_SETTING_INVALID`. The syntax code is an error because it is also why a write is refused;
  none is fatal, because reading never fails.
- A `settings.json` written by an earlier version still reads the same: same keys, plain JSON
  is JSONC, and the defaults it wrote out in full are simply values equal to the defaults.
- Out of PR A: the "Preferences: Open Settings (JSON)" command, the settings tab, the problems
  panel rows, the file watcher and live reload, and the end-to-end suite that proves them.
- PR B (`src/main/settings-live.ts`, `e2e/settings.desktop.test.ts`) builds them, and settles
  four details decision 8 left open. The hash the watcher compares is of the text the app
  **knows is on disk** — the last it wrote _or applied_ — so the same text written back by
  somebody else after a different one is still a change. A reload applies only the keys whose
  effective value moved, so none of the four needs a restart and `requiresRestart` was not
  added. A clean settings tab follows the disk, as an editor reverts a file nobody is typing
  in; a dirty one keeps the person's typing. A refused screen change puts the session back on
  the value in effect and opens the tab, where the `E_SETTINGS_SYNTAX` that refused it shows.
  The tab is plain text: `@tyto/editor`'s `blank(doc, language)` opens one document in another
  language without the host's brief lint and completion; JSON colouring is not built.
