# 0040 — A plugin's engine is the plugin API's version, and a refused plugin does not fail a render

Status: accepted · 2026-09-27 · TYTO-47 · extends ADR 0007

## Context

`tyto-plugin.json` has carried an `engine` range since TYTO-35, checked for shape and
deliberately not for meaning: `>=99` was a well-formed range nobody compared with anything,
because only a loader knows which host is running. E11.1 is that loader, so the range has to
be compared with a number — and there are three candidates on one machine. `apps/cli` was
0.3.1 when this was written, `apps/desktop` 0.5.2, and `@tyto/plugin-api` 0.3.9.

The same card turned a second question from theoretical into real. `createPluginHost` throws
a `TypeError` on a duplicate contribution id, which is right while every plugin is a built-in
this repository wired itself. With installed plugins a duplicate is somebody else's mistake,
and it happens on a machine where a render was asked for by somebody who wrote neither plugin.

## Decision

### The engine is `@tyto/plugin-api`'s version

`PLUGIN_API_VERSION` is exported by `@tyto/plugin-api` and is that package's own version,
inlined from its `package.json` at build time — so a Changesets bump moves it, and nothing
reads a disk at runtime (ADR 0010). Both hosts check `engine` against it, at install and again
at every load.

Not the app's version, because the two apps are versioned separately and a range checked
against whichever one loaded the plugin would mean two things on one machine: `>=0.4` would
install into the desktop and be refused by the CLI beside it. What a plugin is written against
is the host contract, and the host contract is this package.

The check is `satisfiesEngine`, forty lines in the same package rather than a `semver`
dependency, because the manifest schema already narrows a range to one comparator per
alternative. A prerelease host counts as its release: a plugin author cannot name a beta they
have never seen.

### A plugin that cannot be activated is data, and a render goes on without it

`InProcessHost.tryActivate` is the loader's door. It runs the same checks as `activate` — a
manifest that validates, a name that is the id, contributions only to declared points — plus
two that only an installed plugin can fail: a name another plugin already has, and a
contribution id another plugin already holds. Every failure comes back as diagnostics
(`E_PLUGIN_*`), nothing is thrown, and **whatever the plugin registered before it failed is
withdrawn**. A throw from the plugin's own `activate` is caught whatever its class, because it
is foreign code and the only question is whether it finished. Built-ins stay on `activate`,
which still throws: for them each failure is a wiring bug here.

Installed plugins are activated **after** the built-ins, so a built-in always keeps its ids.

On a render each refusal becomes `W_PLUGIN_SKIPPED`, carrying the refusal's own message, in
that task's `result.json`. **A warning and not an error**, because the brief is not what is
wrong: the plugin belongs to the machine, the artwork renders without it, and an error would
make Jacurutu treat a delivery that succeeded as one that failed (ADR 0011). Where somebody
asked for the plugin by name — `install`, `enable` — the same codes are errors and the command
exits 1.

### Approval is recorded, and not yet enforced

`install` shows the manifest's permissions and asks; `plugins.json` beside the plugin folders
records exactly what was approved. A folder with no entry there is not installed, and a plugin
that later asks for more than it was granted is not activated until it is installed again.
**Until TYTO-48 the code runs in Tyto's process with Tyto's reach**, and the prompt says so in
as many words, so that nobody reads an approved permission as a sandbox.

## Consequences

- A plugin author writes `"engine": ">=0.3.9"` against the API package they import types from,
  and the same range means the same thing in both apps.
- Every release of `@tyto/plugin-api` is visible to plugins. A breaking change to the host
  contract has to be a major (or, below 1.0, a minor) bump of that package, or an installed
  plugin written against the old contract will load into the new one.
- `result.json` can carry a warning no line of the brief caused. It has no range, and the CLI
  prints it against the brief's path.
- A collision is found at activation and not at install: install must not run a plugin's code
  before the person has approved it, and a trial activation would be exactly that.
