# 0042 — A permission reaches only what crosses the boundary, and a call has a deadline

Status: accepted · 2026-09-27 · TYTO-48 · extends ADR 0041

## Context

ADR 0041 put each installed plugin behind a message boundary and left two members of
`PluginHost` for the second half of the card: `fetch`, filtered by `net:*`, and `credentials`,
limited to declared keys. It also left a gap its own Consequences named. A plugin whose function
never answers keeps its frame waiting forever. A plugin stuck in `while (true) {}` is the case
isolation exists to contain, and before this ADR it hung the render instead.

## Decision

### Declared, or refused, on the host's side

`host.fetch(url, init)` reaches a host only if the manifest declares it:

- `net:api.example.com` names one host.
- `net:*.example.com` names every host below that domain, and not `example.com` itself.
- `net:*` names any host.

The pattern is compared with `URL.hostname`, so a port is never part of a `net:` permission.
Only `http` and `https` are fetched. `host.credentials(key)` resolves only a key declared as
`credentials:<key>`.

**The check runs where the manifest was validated — the host — never in the plugin's process**,
whose code could skip it. It is one pure function (`checkedCapabilities`), used by the isolated
host and by the in-process host alike, so a built-in is held to its own manifest too. Today no
built-in declares a permission.

**A refusal rejects**, as the platform's `fetch` does. It rejects with a `PluginCapabilityError`
whose `code` is `E_PERMISSION`, which was already in the catalog and is now non-fatal (ADR 0025).
A declared key this host has no value for is `E_CREDENTIAL_MISSING`, naming where the host looked.

**Redirects are not followed.** An adapter answers the 3xx with its `location`, and the plugin's
next request goes through the check like its first. A followed redirect would let a declared
host hand the request to an undeclared one.

The response crosses whole: status, headers and body as bytes. It is read in full first, because
a stream cannot be cloned into a message. `text()` and `json()` are built on the plugin's side.

### Where the network and the secrets come from

A port, `HostCapabilities`, which each app composes:

- **CLI**: Node's `fetch` with `redirect: 'manual'`. Credentials come from the environment, as
  `TYTO_PLUGIN_<NAME>_<KEY>` with both halves upper-cased and every character that is not a
  letter or a digit turned into `_`: plugin `meu-pdf`'s `api.token` is
  `TYTO_PLUGIN_MEU_PDF_API_TOKEN`. An empty variable counts as unset. The environment is where a
  CI job or a cron line already keeps secrets, and Tyto stores none (ADR 0011). Two plugin/key
  pairs can normalise to one variable, `a-b`/`c` and `a`/`b-c`; that is accepted, because it
  takes two plugins written to collide.
- **Desktop**: `safeStorage`, in the desktop half of the card.

The CLI's adapter is the one Node module allowed to call `fetch`. `eslint.config.js` forbids that
global in Node packages, and lifts the rule for `apps/cli/src/plugins/capabilities.ts` alone
(`boundary/cli-plugin-fetch`). This is the first connection Tyto itself opens rather than `git`
or `npm` (ADR 0011). It opens only on a plugin's behalf, and only to a host the plugin declared.

The worker's bootstrap deletes the global `fetch` before the plugin's module is imported. The
obvious way to reach the network is then the checked one. It stops no plugin that imports
`node:http` itself: the thread is not a sandbox (ADR 0041, TYTO-186).

### Every call, and the activation, has a deadline

`PLUGIN_CALL_DEADLINE_MS = 30_000`. A call that passes it answers `E_PLUGIN_TIMEOUT` for the
frame it was for, and so does every other call waiting then; this is non-fatal (ADR 0025), so
the frames other exporters draw are delivered. The process is ended, and the timeout counts as
a crash: `onCrash` is told, `crashes.json` records it, and later calls answer
`E_PLUGIN_CRASHED`. An activation that does not finish in the same time refuses the plugin
(`E_PLUGIN_ACTIVATE`).

**30 s is ADR 0030's capture deadline, for the same reason.** One frame's work takes
milliseconds when it works. A person watching a stuck export gives up well before a minute. A
legitimate call waiting on a slow `host.fetch` still has room. The frame is the unit in both
places, so the two limits are one number. The clock is the host's own thread, and it keeps
running while the plugin's thread spins.

## Consequences

- `PluginHost` has two new members. A plugin written against the old contract still loads,
  because it only calls what it knew. The in-process host gains an optional `capabilities` port.
- The CLI hands credentials only from its own environment. `CliEnvironment.variables` is absent
  in tests, so a test never passes a machine's secrets to a plugin.
- A plugin that needs more than 30 s for one frame cannot be written today. If one exists, the
  deadline becomes the manifest's to ask for, within a ceiling. That would be a new ADR.
- The desktop's plugins screen still says the permissions are not enforced. For the CLI that
  sentence is now out of date; it changes with the desktop half.
