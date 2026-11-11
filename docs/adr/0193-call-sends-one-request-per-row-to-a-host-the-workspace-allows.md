# 0193 — `call` sends one request per row to a host the workspace allows

Status: accepted · 2026-11-11 · TYTO-671 · builds on ADR 0042, ADR 0127, ADR 0129, ADR 0134,
ADR 0140, ADR 0170, ADR 0172, ADR 0185, ADR 0188 and ADR 0191

## Context

TYTO-392 maps every step of a private pipeline to Tyto. One step posts each new row to an
external routine endpoint with its own token, and remembers which rows it already dispatched so
it never posts one twice. The maintainer chose, on 2026-11-11, a new verb in Tyto over keeping
the old pipeline for that step alone.

Tyto knows no provider (ADR 0011, ADR 0127): the URL, the credential and the body come from the
recipe and the workspace, never from code. Four questions were open:

- Where does the network call run? `@tyto/recipe` is pure (ADR 0010): no Node, no DOM, no
  `fetch`.
- Who allows the host? A recipe that names any URL would let a shared recipe send a person's
  rows anywhere.
- Where does the token live, and how does it stay out of every plan, log and diagnostic?
- How does a run avoid sending a row twice, and what of a request that fails?

TYTO-671 lands in three pull requests: this record, the pure verb, its port and the plugin
contract's wiring; then the port's adapter in `@tyto/io` and the CLI; then the desktop's place to
store and forget the credential.

## Decision

1. **`call` is a generic action, bare-named, over ports the host lends.**
   `call url=<https address> token=<credential> body=<json>`. It is Tyto's word, as `to-brief` is
   (ADR 0172), so it lives in `@tyto/recipe` and is in `GENERIC_VERBS` and `GENERIC_VERB_FORMS`.
   `CallPorts` names four things, all bound by the host to one run's workspace and recipe:
   `hosts()` the hosts the workspace allows, `hasCredential(name)` whether a credential is stored
   (never its value), `send(request)` one request, and `now()` the clock that stamps an applied
   one. The host passes them as `createVerbRegistry({ calls })`, which `recipeRegistriesOf`
   forwards from its own `calls` option. `@tyto/plugin-api` names the types, so `@tyto/io`'s
   adapter implements a port from it, and the desktop and the CLI share that adapter (ADR 0188).
   - **v1 is minimal.** The method is always `POST`; there is no `method=`. The body is always
     JSON, sent as `application/json`. The credential is always sent as
     `Authorization: Bearer <value>`; there is no `header=`. The URL is fixed per line (a
     `{param}` may fill it, a column may not), so the allow-list is checked once, at the line.
     Each of these can be added later as an argument without changing what a v1 line means.

2. **Running sends nothing; the plan is one `request` per row** (ADR 0129). Its description is
   `POST <url> <body>`, the body cut at 300 characters, and its payload `{ url, bytes }`. The verb
   keeps every plan it answered in a `WeakMap` by the plan object, as `to-brief` does (ADR 0172
   decision 3), and Apply sends from what it kept: a body is not bound by a payload's 2,048 bytes
   (ADR 0170 decision 1), and a copied or edited plan is refused with `E_RECIPE_APPLY`. A body is
   at most **16 KiB** (`CALL_BODY_LIMIT_BYTES`), and a plan at most **1,000 requests**
   (`CALL_PLAN_LIMITS`); past either is an error naming the row, never a plan sent in part.

3. **The body is JSON whose strings are templates over the row.** `body=` is inline JSON to the
   end of the line, or a data reference `@./call.json#/pointer` (ADR 0137). Each string value is
   a `compose` template (ADR 0136): `{column|}` on a recipe line, where `{name}` is a parameter,
   and `{column}` in a data file. Keys, numbers, booleans and `null` are sent as written. The
   body is built as a value and serialised once, so a cell holding a quote or a brace cannot
   break out of its string. An empty cell is an empty string.

4. **The host must be on an allow-list the workspace writes, in a trusted folder.**
   - The list is **`recipes.call.hosts`** in `.tyto/project.json`: an array of host names,
     compared in lower case with the URL's host, without its port, as a `net:` permission is
     (ADR 0042). No wildcard in v1: each host is named.
   - **Only a trusted sheet's list counts.** A restricted folder's (ADR 0111) is withheld, as a
     plugin's section is, and a recipe in no workspace or a restricted one has no list:
     `hosts()` answers `undefined`, and `call` refuses to plan. Sheets merge as a list key does
     (ADR 0112): the later sheet's list replaces the earlier's whole.
   - **Only `https:`.** An address with a user, a password, a fragment or a blank is refused.
     The verb reads the address by hand, since `@tyto/recipe` has no `URL`; the adapter parses it
     again with the platform's parser and checks the host against the list again before it
     sends.
   - **A host not on the list is refused at plan time**, with `E_RECIPE_CALL` at `url=`, saying
     where to add it. The verb's own arguments can never widen the list.
   - Apply asks `hosts()` again: a folder restricted, or a host taken off the list, since the plan
     refuses the whole Apply before any request.

5. **The credential is named by the recipe and stored on the machine; the verb never holds it.**
   - `token=<name>` is lower-case letters, digits and `-`, up to 64 characters. Neither the
     recipe nor the project file ever holds the value.
   - **The desktop keeps it in the OS keychain through `safeStorage`, under the account
     `recipe:<name>`**, beside `plugin:<name>:<key>` and `signin:<plugin>:<id>` (ADR 0134). No
     `credentials:<key>` a plugin declares can name it, since every plugin's account begins
     `plugin:`. The desktop gives a person a place to store and forget one (third pull request).
     The values are per machine and shared by every workspace on it; the allow-list, not the
     credential, is what a workspace decides.
   - **The CLI reads it from the environment**, as it does a plugin's (ADR 0042), as
     `TYTO_RECIPE_CREDENTIAL_<NAME>`, upper-cased with every character that is not a letter or a
     digit turned into `_`. The CLI stays read-only for credentials (ADR 0134).
   - **The host puts it in the header** (ADR 0191 decision 1): `send` takes the credential's
     name, and the adapter reads the value and sets `Authorization` on its side. So the value
     never enters `@tyto/recipe`: not a plan, not a diagnostic, not an outcome's reason, not a
     log. An error the adapter raises is reported with every secret it carried replaced by
     `[credential]`, as ADR 0191 does for a plugin.
   - A credential not stored is refused at plan time with `E_RECIPE_CALL` at `token=`, and one
     forgotten since the plan refuses the whole Apply.

6. **Apply sends the requests one by one, each with its own outcome.**
   - **Redirects are never followed** (ADR 0042): a 3xx is answered as its status, so the header
     never reaches a host the list did not name.
   - **Each request has a deadline**, `CALL_DEADLINE_MS` = 30 seconds, passed in the request and
     enforced by the adapter; one past it fails that row.
   - **A 2xx is applied. Anything else fails that row**, with the status as the reason
     (`hooks.example.com answered HTTP 503`), or the adapter's reason when there was no answer.
     **The response's body is never read into the outcome**, so a server that echoes a request,
     or a stack trace, is not shown or kept. The other rows still go.

7. **Not sending a row twice is a recipe pattern, not an option of the verb.** ADR 0140 already
   commits a `remember` only for rows whose operations applied (`stateToCommit`), so:

   ```text
   last dispatched
   where last_stored_at is empty
   call url=https://hooks.example.com/run token=routine body=@./call.json#/routine
   remember dispatched columns=title
   ```

   plans every row the store has not seen, and after Apply stores only the rows whose request
   answered 2xx. The next run plans the failed rows again and the sent ones never. A test runs
   this recipe twice: 2 requests, then 0, and a failed row is the only one planned again.

8. **A host that sends nothing still plans.** Without `send` (or without any `CallPorts`), the
   plan is shown with the target `requests to <host> (this host sends none)` and its Apply is
   refused with `E_RECIPE_APPLY`: "this host sends no requests". **`tyto mcp`'s `run_recipe`
   gets no `send`** (ADR 0185 limits what an agent writes to briefs, deliveries and exports), so
   an agent can preview a dispatch and never carry one out. A host with no `CallPorts` at all
   cannot read the allow-list, so its plan checks only the address; one with `hosts` and
   `hasCredential` and no `send` checks everything.

9. **One new code, `E_RECIPE_CALL`**, for every plan-time refusal, at the argument that caused
   it. Apply's refusals are `E_RECIPE_APPLY`, as for every verb.

## Alternatives

- **A built-in plugin with `net:` and `credentials:` permissions.** Rejected: a plugin's
  permissions are fixed in its manifest when it is installed (ADR 0042, ADR 0134, ADR 0191), and
  a list each workspace writes would need a permission that changes per folder and per run, which
  no part of the plugin contract has. A built-in would also need `net:*`, which ADR 0191 refuses
  to count as naming a host. The host port keeps the list where the folder's trust already is.
- **The allow-list in the recipe.** Rejected: a recipe is shared, and the person who runs it
  should not have to read it to know where their rows go. The project file is the workspace's,
  and trust decides whether it is read (ADR 0111).
- **The verb reads the credential and sets the header itself.** Rejected: the value would pass
  through the pure package, where any plan, diagnostic or log line could carry it. Naming it and
  letting the host send it is ADR 0191's rule for plugins, applied to Tyto's own verb.
- **An idempotency option (`once-by=<column>`).** Rejected for v1: `last`, `where` and
  `remember` already say it, with the failed-row rule ADR 0140 tested, and a second mechanism
  would disagree with the first one day.
- **A body as one text template.** Rejected: a template has no escaped brace (ADR 0136), so JSON
  could not be written in one, and a cell holding `"` would break the body.

## Security

**`call` is the first path in Tyto's core that sends a person's data over the network on
Apply.** Until now only a plugin did, under the permissions its manifest declared (ADR 0042), and
only `to-brief` wrote anything of a row, to the workspace. What holds it:

- Nothing leaves before a person applies a plan that shows every request, its URL and its body.
- The host must be on a list in a trusted folder's own project file; a recipe can neither write
  nor widen it, and a restricted folder sends nothing.
- `https:` only, no redirect followed, a deadline per request, the response's body never kept.
- The credential never enters the recipe package, and only the host it was sent to sees it.
- An agent over MCP can preview and never send.

What it does not hold: a person who adds a host to the list and stores a token trusts every
recipe in that folder to send any column of its rows there. A body is whatever the recipe's
template takes from the row, and the plan is the only place a person sees it.

## Consequences

- A recipe can tell another system about each new row with one Apply, and a row it already
  told is never sent again, the failed ones retried on the next run.
- `@tyto/io` gains the adapter (second pull request): the platform's `fetch` with
  `redirect: 'manual'` and an abort at the deadline, the allow-list read from the resolved
  project, and the credential from the keychain or the environment. Core's project resolver
  learns `recipes` as a known key, with `call.hosts` read from trusted sheets only; until then a
  project that writes it is warned about an unknown key.
- The CLI and `tyto mcp` run `call` through the same runner (ADR 0188); only the desktop and the
  CLI lend `send`.
- A person whose endpoint wants another method, header or body format cannot use `call` yet.
