# 0191 — The host sends a plugin's secret, and keeps its durable records

Status: accepted · 2026-11-11 · TYTO-661 · builds on ADR 0042, ADR 0134, ADR 0138 and ADR 0187

## Context

TYTO-661's driver calls the Claude API with the person's own key and stops new turns at a
monthly cost cap the person sets. Two things the host did not offer stood in the way, read on
`origin/main` at 94c593c0:

- **A secret the plugin does not hold.** `host.credentials(key)` hands the value to the plugin's
  process (ADR 0134), and `host.fetch` takes headers as plain values (ADR 0042). So the only way to
  send an API key was to read it into the plugin's memory, where a log line, an error or an answer
  to the panel could carry it.
- **A record that survives.** `host.cache` lives in `<home>/cache/plugins/<name>/` (ADR 0138): a
  person who wipes `cache/` resets it, ADR 0130 speaks of clearing a plugin's cache, and it is not
  removed with the plugin. A spend ledger kept there would reset the cap with a cache wipe. The
  credential store is capped at 16 KiB and ADR 0134 forbids it as general storage; workspace
  files belong to a folder; `TYTO_PROGRAM_DATA` (ADR 0187) is a program's, and the plugin's own
  process is confined away from it (ADR 0049).

## Decision

1. **`host.fetch(url, { credentialHeaders })`: the host puts the secret in the header.**
   `credentialHeaders` maps a header name to a credential key —
   `{ 'x-api-key': 'anthropic-api-key' }` — and the host reads the value and sets the header on
   its side. **The plugin's process never holds the secret**: across the isolation boundary only
   the key's name travels, and the answer is the response, as before.
   - **Each key needs its `credentials:<key>`**, as for reading it.
   - **The request's host must be one a `net:` permission of the plugin's names itself**, exactly
     or under `*.<domain>`. `net:*` reaches every host and names none, so it does not count. Any
     other host is **`E_CREDENTIAL_HOST`**, before any secret is read. Redirects are still not
     followed (ADR 0042), so the header never reaches a host the request was not sent to.
   - A header name that is not an HTTP token, or that the request also sets as a plain header, is
     a `TypeError`. A key with no value is `E_CREDENTIAL_MISSING`, as for reading it.
   - **An error the adapter throws is rethrown with every secret it carried replaced by
     `[credential]`**, message and stack, so not even a careless adapter hands one to the plugin.
     A server that echoes a request header back in its response is the server's: the host does
     not rewrite responses.
   - `credentialHeaders` never reaches the adapter: the port sees an ordinary request.
   - A panel's page (ADR 0045) does not get it: its `fetch` schema is unchanged, and a page that
     needs a secret sent asks its own plugin through `call`.

2. **`host.storage`: small durable records, under ADR 0187's data root.** `get(key)` answers the
   stored JSON value or `undefined`; `set(key, value)` stores one, replacing any; `delete(key)`
   answers whether there was one. A key is 1 to 128 of `A–Z a–z 0–9 _ . -`; a value is JSON that
   reads back as itself — plain objects, arrays, strings, finite numbers, booleans and `null`,
   checked before it crosses — of at most **64 KiB** as UTF-8 JSON text. A stored `null` is a
   record, not a miss. No permission: like the cache, it holds only what the plugin put there.
   Every refusal is **`E_PLUGIN_STORAGE`**.
   - **On disk it is `<home>/data/plugins/<name>/storage/<sha256(key)>.json`**, each file
     `{ key, value }`, written beside its name and renamed into place. One root per plugin, the
     one ADR 0187 gave its programs: **an update keeps it, removing the plugin deletes it**
     (`fsPluginStore.remove` already deletes the whole data folder), disabling keeps it, and a
     wiped `cache/` does not reach it. The key is hashed so two keys that differ only by case stay
     two records on a file system that ignores case, and no key names a device on Windows.
   - **A file that exists and cannot be read as this key's record is refused, never answered as
     missing.** A plugin that keeps a ledger must be able to tell "nothing yet" from "something I
     cannot read", or a corrupt ledger reads as an empty month.
   - **The CLI implements it too**, under the same `TYTO_HOME`; a command composed without a home
     answers `E_PLUGIN_STORAGE` naming itself. The desktop implements it beside the cache.
   - A plugin's own programs see the same folder through `TYTO_PROGRAM_DATA`. They are the
     plugin's, and could already write there; the `storage/` subfolder is the plugin's process's.

3. **What a missing ledger means for a cap.** A record that is missing reads as `undefined`, so a
   plugin that keeps a spend ledger under `host.storage` reads a month it has no record for as
   zero spent. That is true for a new month, a new install and a plugin removed and installed
   again — removing the plugin deletes its records, and with them the month's spend. It is not
   true for a restart, an update or a wiped cache, which keep the record. A record that exists
   but cannot be read is an error, which a plugin keeping a cap treats as "cap reached" rather
   than as zero. The host does not know what a cap is; this is the contract a plugin builds one
   on.

4. **Across the isolation boundary, protocol 24.** `fetch` may carry `credentialHeaders`, which
   the strict schema of a host on 23 would refuse, and the guest asks `storageGet`, `storageSet`
   and `storageDelete`. `storageGet` answers `{ found: false }` or `{ found: true, value }`,
   because `null` is a value. The ports are optional on `HostCapabilities`: `storageGet`,
   `storageSet` and `storageDelete`, which take and answer the record as JSON text;
   `checkedCapabilities` stands in front of them and of `fetch`, in process and isolated alike.
   `testPlugin` keeps records in memory for the harness's life.

## Consequences

- The agent panel sends the person's API key without ever holding it, and keeps the month's
  spend where a cache wipe, a restart or an update leaves it.
- A plugin that already reads a credential and sets the header itself keeps working; this adds a
  way, it removes none.
- A plugin that declares only `net:*` cannot use `credentialHeaders`: it has to name the host.
- Records have no total ceiling per plugin, as the cache has none; a record has 64 KiB. A plugin
  that needs more needs a new ADR, not a bigger constant, for the reason ADR 0134 gave for
  secrets.

## Alternatives rejected

| Alternative                                         | Why not                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Read the key into the plugin and scrub its logs     | Every log line, error and panel answer would have to be scrubbed forever; one miss leaks it   |
| Allow `credentialHeaders` to any host `net:` allows | `net:*` would let a plugin send the person's key anywhere; the person approved hosts, not "*" |
| Keep the ledger in `host.cache`                     | A cache wipe resets the cap, and the cache is not removed with the plugin                     |
| Keep the ledger in the credential store             | 16 KiB and ADR 0134 keeps secrets from becoming general storage                               |
| A new top-level `<home>/plugin-data/`               | Two roots per plugin; ADR 0187's is already kept by updates and removed with the plugin       |
| Answer an unreadable record as missing              | A corrupt ledger would read as zero spent: a cap that resets on a bad write is not a cap      |
