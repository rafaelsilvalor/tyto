# 0145 — An installed plugin declares a setting as a data form

Status: accepted · 2026-10-26 · TYTO-254 · amends ADR 0073; builds on ADR 0041, ADR 0049,
ADR 0092, ADR 0127, ADR 0134, ADR 0136 and ADR 0138

## Context

ADR 0073 gave plugins the `configuration` point: a setting is declared with a Zod schema, and
`resolveSettings` validates each key of `settings.json` against it, one at a time, with a ranged
`W_SETTING_INVALID` for a value it refuses. A Zod schema is code. It does not cross to an
installed plugin's process (ADR 0041), so `registerConfiguration` was in `NOT_YET_ISOLATED` and
refused by name there, and only in-process plugins — the built-ins — could have a setting.

The connector plugins of ADR 0127 need one: `tyto-plugin-jira` its site's base URL and an email,
`tyto-plugin-google` a root folder and sheet ids. Two other gaps stood behind the first. The
guest's `host.config(schema)` read the configuration only from the `activate` message, which
`startPlugin` never filled, and no message carried a later change; so even a setting the host
could validate would never have reached the plugin's code.

## Decision

1. **A setting's rules cross as a form: a small, closed slice of JSON Schema's words.** A form is
   a scalar or a list of one scalar:

   - `type`: `string`, `number`, `integer` or `boolean`; `nullable: true` accepts `null` too.
   - `enum`: the only values accepted, at most 200, each a JSON scalar of the form's type. It
     stands alone: a bound beside it is refused, because the list already says every value.
   - `minimum`/`maximum` for a number or an integer; `minLength`/`maxLength`, `pattern` and
     `format: 'uri'` (an absolute URI, as `URL` parses it) for a string. A keyword of another
     type, or a low bound above its high one, is refused.
   - `pattern` is **`tyto-pattern/1`** (ADR 0136), compiled by the recipe package's
     `compilePattern`: flags `iu`, at most 512 characters, and the guard's refusal of a
     backreference, a lookaround and nested quantifiers, so a setting cannot bring a pattern
     whose matching time has no bound. One pattern dialect for the whole of Tyto, even though
     JSON Schema's `pattern` is case-sensitive: a plugin that needs case uses a class.
   - `type: 'array'` with `items` (one scalar form) and `uniqueItems`. It maps onto the
     existing `entries` rule (ADR 0091), so a refused or repeated entry is
     `W_SETTING_ENTRY_INVALID` at that entry and the rest apply.

   **No object in v1.** An object form would need `members` (ADR 0091) and per-name schemas, and
   no plugin has asked; one setting per value is the way today. **No secret field.** A setting
   is plain text in `settings.json`, which a person copies, syncs and pastes into a bug report;
   a secret is a declared credential behind `safeStorage` (ADR 0134), and a setting must not
   hold one. The form is strict, so a `secret: true` is refused rather than ignored.

2. **The host converts; nothing else changes.** `settingSchemaOf(form)` in `plugin-api` is pure
   and answers the Zod schema; `declaredSetting` converts a `form` declaration before anything
   else, so the setting goes through the unchanged `declaredSetting`/`resolveSettings`: the same
   per-key tolerance, the same ranged `W_SETTING_INVALID`, and a default the form refuses is the
   plugin's bug and `E_PLUGIN_ACTIVATE`, as a default its schema refuses already was. A form Tyto
   cannot read throws the same way, naming the setting. The settings tab's outline (ADR 0092)
   reads the converted schema like any other.

3. **Declaring.** `host.registerConfiguration` takes `form` instead of `schema` — exactly one of
   the two, or the declaration throws. Any plugin may use a form; an isolated one must. The
   `configuration` point is now in `ISOLATED_POINTS`, crossing as data checked against the form
   contribution's schema (`id`, `form`, `default`, `description`, `options`), and is no longer in
   `NOT_YET_ISOLATED`. An isolated plugin that passes `schema` is refused in its own process, by
   name, with a message that says to use `form`.

4. **Protocol 7: the host sends a plugin its settings again.** A host→guest `configure
{ config }` message carries the plugin's slice; the guest replaces the `config` that
   `host.config` answers and emits `configured` locally. The proxy sends it when it is activated
   into a host that holds a slice, and again on every `InProcessHost.configure`, which now emits a
   `configured` event on `HostEvents` — an event rather than a listener on `InProcessHost`,
   because the proxy holds only the `PluginHost` it was activated with, and a plugin in process
   may want to re-read its settings too. The messages share one ordered channel, so a call sent
   after a `configure` reads the new values. A guest on 6 is refused at `hello`.
   **When one isolated plugin is activated into several hosts, the last `configure` wins**: the
   process holds one configuration, and every host the CLI or the desktop builds is configured
   from the same reading, so the hosts never disagree in practice.

5. **The CLI never reads the desktop's `settings.json`** (Rafael, 2026-10-26). That file is one
   machine's preference for the window, and a render must not change with it. In the CLI an
   installed plugin's settings take their defaults: every host it activates installed plugins
   into is configured with `resolveSettings(declared, [])`. Values a workspace chooses — the
   connector's base URL for one company — belong in the plugin's section of that workspace's
   `.tyto/project.json` (ADR 0127 decision 4), read as a list of entries `resolveSettings`
   already takes. That is TYTO-428; nothing here blocks it.
   _Amended 2026-10-27 (TYTO-428, ADR 0147):_ the section does not go through
   `resolveSettings` and `configure`. `configure` is process-wide and the last one wins, so a
   folder's values would leak into the next folder's run; a form has no object; and sources
   already get the section raw. It rides on each source and recipe verb call instead, as
   `section`, and `tyto render --section` types keys over it.

## Consequences

- `plugin-api` gains `SettingForm`, `settingFormSchema`, `settingSchemaOf`,
  `SETTING_FORM_LIMITS`, `FormConfigurationContribution` and `SettingDeclaration`;
  `registerConfiguration` takes a `SettingDeclaration`, and `HostEvents` gains `configured`. A
  minor version. `RPC_PROTOCOL_VERSION` is 7.
- A guest built for 6 and a host built for 7 refuse each other at `hello`, as every bump has.
  Both ends ship in one app, so only a bootstrap left behind by an upgrade meets it.
- The desktop already configures its host from `settings.json` on start and on every reload
  (ADR 0073), so an installed plugin's setting reaches it there through the same event; showing
  and editing those settings in the window, with their diagnostics, is the desktop's second pull
  request of TYTO-254.
  _Corrected 2026-10-27 (TYTO-254, desktop pull request):_ the bullet above was wrong. The host
  the desktop configured on start and on every reload was the built-ins' alone; installed plugins
  are never activated there. They live in the window's host (`window-plugins.ts`) and in a host
  built per export, and neither was configured, so no value reached an installed plugin. The
  desktop now configures both from the same reading: the window's host on every reading, and each
  export's host before the installed plugins are activated into it. The file is checked against
  the built-ins' settings and the installed plugins' together; the settings tab's validation and
  outline, and the log of the file's problems at launch, wait for the installed plugins to
  start, and the file is read again then. So a plugin's key is unknown only when its plugin is
  not running — and then the warning is `W_SETTING_PLUGIN_NOT_RUNNING`, which names the plugin,
  for one installed but disabled, failed or refused. Since #200 the desktop's export also waits
  for the installed plugins to be configured before it runs, so an export started at launch
  does not run on their defaults.
- A pattern in a form is case-insensitive. A JSON Schema written for another tool and copied in
  may accept more than its author meant; the ADR says so rather than adding a second dialect.
- Out: object forms, `minItems`/`maxItems`, `format`s other than `uri`, and per-workspace values
  (TYTO-428).
  _Amended 2026-10-27:_ per-workspace values are ADR 0147's — the plugin's project section on
  each call, not a setting.
