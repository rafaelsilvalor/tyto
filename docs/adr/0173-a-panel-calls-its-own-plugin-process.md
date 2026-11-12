# 0173 — A panel calls its own plugin's process, through a checked `call`

Status: accepted · 2026-11-08 · TYTO-372 · builds on ADR 0041, ADR 0042, ADR 0045, ADR 0127 and
ADR 0134

## Context

A panel (ADR 0045) is a sandboxed page that reaches the host through a `postMessage` bridge, and
the bridge offers `fetch` and the credential requests, checked against the plugin's permissions.
A connector's settings or sign-in panel (ADR 0127) needs more: test the token it was given, list
a Drive folder to pick from. Today that logic has to be written twice, once in the plugin's
process and again in the page's JavaScript, and the page receives the plaintext credential to do
it. The plugin's process already holds the logic and reaches the credential without showing it
to anybody.

So the page should ask its own plugin's process to do the work. Four questions were open:

- What does the page send, and what comes back?
- How is "its own plugin" decided, when the page is anybody's JavaScript?
- What bounds a call, in size and in time?
- What happens to the panel's `credentials` read?

TYTO-372 lands in two pull requests: this record, the contract in `@tyto/plugin-api`, the
isolation protocol and its tests; then the desktop's bridge (`PANEL_CAPABILITIES`, `panels.ts`,
`plugin-panel.ts`), the authoring docs and a desktop test.

## Decision

1. **A panel contribution gains an optional `call(request)`.** The request is
   `{ method, params? }`: `method` matches `^[a-z][\w.-]{0,99}$`, a name the plugin chose such as
   `token.test` or `folder.list`, and `params` is any JSON value. The answer is
   `Result<JsonValue, Diagnostics>`, as every other callable answers. One method name per call
   and one function per panel, rather than a map of functions: the plugin dispatches on
   `method` itself, so adding a method changes the plugin and not the contract. `params` is
   optional because a status check has nothing to send.
2. **The host decides which plugin answers, never the page.** `callPanel(panel, request)` takes
   the contribution the caller found from what it trusts — on the desktop, the panel id read off
   the iframe element the message came from (ADR 0045) — and `panelCallerOf(registry)` looks the
   panel up by that id in the registry, read per call, so a withdrawn plugin stops answering.
   **The request schema is strict**: a `plugin` or `panel` key the page adds is refused with the
   whole request rather than ignored, because a name the page can write is a name the page can
   forge. A panel reaches its own plugin's `call` and no other.
3. **Both directions are held to 1 MiB of JSON**, counted as UTF-8 bytes of `JSON.stringify`
   (`PANEL_CALL_MAX_BYTES`). A panel asks for a status or a list, not a file; a megabyte holds a
   folder of thousands of entries and keeps one call one message. The host checks the request
   before any plugin sees it and the answer after, for an in-process plugin as for an isolated
   one. An isolated plugin's process checks the request again with the same schema, so a host
   that skipped its check still cannot hand the plugin a bad method; its answer is checked by
   the callable's result schema on the way back, which refuses an oversized one as
   `E_PLUGIN_PROTOCOL`, the code every malformed isolated answer has.
4. **Time is the deadline every isolated call already has**: `PLUGIN_CALL_DEADLINE_MS`, 30 s
   (ADR 0042). `call` is one more callable on the `panel` point, so it rides the same path as an
   exporter's `exportFrame`: past the deadline the answer is `E_PLUGIN_TIMEOUT` and the process
   is ended, as for any call. An in-process plugin has no deadline, as no in-process call does.
5. **`E_PANEL_CALL` is the host's refusal**: no `call` registered, no panel with that id, a
   request that is not `{ method, params? }` or breaks the method pattern or the ceiling, an
   answer that is not a result or not JSON within the ceiling, or a throw from an in-process
   `call`. The plugin's own refusal, and what isolation answers for a call it could not finish
   (`E_PLUGIN_TIMEOUT`, `E_PLUGIN_CRASHED`, `E_PLUGIN_CALL`, `E_PLUGIN_PROTOCOL`), reach the
   page as they are, so the page can tell "my plugin said no" from "the host said no". It is
   non-fatal: only that call is refused.
6. **The isolation protocol is 17**: the `panel` point's callables gain `call`, which the strict
   registration schema of a side on 16 would refuse.
7. **The panel keeps its `credentials` read for now; `call` is the way forward.** Removing the
   read would break the panels that use it today before any of them can move. A panel that
   needs a secret's effect, not its value, should ask its process through `call`, which never
   puts the secret in the page. Dropping the read is a later card, once the connectors that
   read it have moved.
8. **Nothing flows from the plugin to the page on its own.** A call is a request and an answer:
   no events pushed from the process, no streaming, no cancel. A long job answers a handle the
   page asks about again, within each call's deadline.

## Consequences

- A connector's panel can test a token or list a folder through its own process, with the
  credential staying in that process.
- A page cannot reach another plugin's process: the lookup reads only the caller's id, and the
  strict schema turns a forged name into a refusal. The isolation tests prove it with two
  plugins in one host.
- A call that hangs ends its plugin's process, as an export call that hangs does. A panel that
  polls a slow service must keep each call under 30 s.
- The desktop does not offer `call` yet: `PANEL_CAPABILITIES` and the bridge change in the
  second pull request of TYTO-372. Until then a plugin may register `call` and nothing calls it.
- Every isolated plugin and host pair must speak protocol 17; both ship inside the same app, so
  only a worker bundle left behind by an upgrade notices.

## Note, 2026-11-08 — the desktop's bridge offers `call` (TYTO-372, second pull request)

`PANEL_CAPABILITIES` gains `call`, with `args: [method, params?]`, on the existing
`panel:request` channel. Main finds the `WindowPanel` from the layout id the renderer read off
the iframe's element, matching plugin and panel id together, because two plugins may each name a
panel `settings` and `panelCallerOf`'s bare-id lookup would answer with the first; it then calls
`callPanel` with that contribution, fetched plugins' included. The renderer's bridge answers a
request with a key its strict shape does not have — a `plugin`, a `panelId` — with `E_PANEL_CALL`
(`E_PLUGIN_CALL` for the other capabilities) instead of dropping it in silence, so a page that
tries to name another plugin hears no rather than waiting for an answer.

## Note, 2026-11-12 — lookup by plugin and id; one answer shape on both paths (TYTO-644)

Decision 2: `panelCallerOf(registry)` now answers `(plugin, panelId, request)` and finds the
panel by the contributing plugin's name and the panel id together, read from the registry's
`ownedPanels()`; a pair nobody registered is `E_PANEL_CALL` naming both. One host refuses a
second panel id, but a host composing several registries may hold two `settings`, and the id
alone would answer with the first — the gap the note above worked around on the desktop.

Decision 3: the in-process path checks the plugin's answer with `panelCallResultSchema`, the
same schema object the `panel` point's `call` holds an isolated answer to on the wire, and an
answer it refuses is `E_PLUGIN_PROTOCOL` naming the plugin, built by the same function the
isolated path uses. It refuses, never normalises: `{ ok: true, value }` without `diagnostics`,
an answer that is not a result, a value over the ceiling or not JSON are refused alike on both
paths. This moves those answers out of decision 5's `E_PANEL_CALL` list; a request the host
refuses, a missing `call` and a throw from an in-process `call` stay `E_PANEL_CALL`.
`callPanel` takes the plugin's name as a third argument, for that refusal. The wire contract
does not change, so the isolation protocol stays where it is.

## Note, 2026-11-12 — a panel no longer reads a credential (TYTO-641)

Decision 7 is superseded. Read on 2026-11-12, the connector it waited for has no panel, and the
one published panel that handles a secret stores it with `storeCredential` and reaches its
plugin through `call`, never reading it back: nothing had to move first. The desktop now answers a panel's `credentials` request with
`E_PANEL_CREDENTIAL_READ`, whose message names `call`, before any permission check or keychain
read, so a declared key and an undeclared one hear the same refusal and nothing about whether a
value is stored. No manifest opt-in brings the read back: a page is anybody's JavaScript, and the
plugin's process is where a secret is used. `credentials` stays in `PANEL_CAPABILITIES` so the
page hears that answer rather than a shape error that cannot point to `call`. `storeCredential`
and `deleteCredential` are unchanged: a settings panel writes a secret it never reads back.
