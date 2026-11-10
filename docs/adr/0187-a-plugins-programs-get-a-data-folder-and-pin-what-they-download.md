# 0187 — A plugin's programs get a data folder, and pin what they download

Status: accepted · 2026-11-10 · TYTO-666 · extends ADR 0182 decision 8 · amends ADR 0184
decision 4 · builds on ADR 0049 and ADR 0138

## Context

TYTO-662 would have shipped Claude's ACP adapter inside the agent panel plugin, and it was dropped.
The adapter's runtime dependency, `@anthropic-ai/claude-agent-sdk`, is all rights reserved, and
nothing in Anthropic's terms allows copying it into a public repository. TYTO-666 does what Zed
does instead. On first use it fetches the adapter from the npm registry, at a version the plugin
pins, into a copy only the plugin uses. The person's own Claude Code then signs in.

Measured on 2026-11-10: `@agentclientprotocol/claude-agent-acp` 0.104.1 installs as 107 npm
packages, 69 MB, with the SDK's platform binaries left out (they are optional, and
`CLAUDE_CODE_EXECUTABLE` makes them unnecessary). Tyto ships Node (ADR 0050) but not npm, and a
person who installed Claude Code natively has none. So the plugin brings a small installer of
its own: a `programs` script (ADR 0184). Such a script already has a full process's reach, so it
can download. Three things were missing, read on `origin/main` at 313f28f1:

- **A program learns no folder of Tyto's.** ADR 0182 decision 8's environment allowlist holds the
  person's home and system folders, and `TYTO_WINDOW`. Nothing names a place that belongs to the
  plugin. A script could work one out from its own path (`<home>/plugins/<name>/…`), but that
  ties a plugin to Tyto's layout.
- **The plugin's own folder is the wrong place.** `fsPluginStore.add` replaces it whole on every
  update (copied beside it and swapped in), so a download kept there is lost at each version.
- **The plugin's cache is not a folder.** `host.cache` (ADR 0138) keeps bytes under a key, with a
  sidecar per entry, at most 32 MiB each, in `<home>/cache/plugins/<name>/`. A program cannot
  import a node_modules tree out of it, and the cache is not removed with the plugin. It is the
  only per-plugin storage Tyto had.

## Decision

1. **Every program the host starts for a plugin is told its data folder in `TYTO_PROGRAM_DATA`.**
   The value is an absolute path, `<home>/data/plugins/<name>`. `<home>` is Tyto's own folder
   (`~/.tyto`), the one that holds `plugins/`, `plugins.json` and `cache/`.
   `PROGRAM_DATA_VARIABLE` in `@tyto/plugin-api` names the variable, and
   `pluginDataDirectory(home, name)` in `@tyto/io` names the path. It is given to a program
   from `PATH`, to a plugin's own program and to a terminal tab (ADR 0184 decision 6) alike.
   The program is the plugin's either way, and a folder it may use hides nothing.
   - **The host sets it, like `TYTO_WINDOW`.** It joins ADR 0182 decision 8's environment by
     name, as a variable the host adds, not one it passes through. A value under that name in
     main's environment is never passed on, with or without a data folder. The name does not
     start with `TYTO_PLUGIN_`, which the allowlist keeps out as the plugin's secrets, and it is
     not shaped like a secret.
   - **Created only for a start that passed every refusal.** A restricted folder, a program not
     on `PATH` or a missing script creates nothing. The desktop creates the folder before it
     spawns the program, so the program can rely on it.
   - **Outside the plugin's folder and outside its cache.** An update keeps it. **Removing the
     plugin deletes it**, in `fsPluginStore.remove`, with the plugin's folder. Disabling the
     plugin keeps it. A name that no plugin could have has no data folder.
   - **The plugin's own process cannot reach it.** ADR 0049 confines that process to its own
     folder, and this changes nothing there. Only the program, which runs as the person,
     reads and writes the data folder.

2. **No new permission, and no new sentence in the install prompt.** A program already reads and
   changes the person's files (ADR 0182, ADR 0184 decision 4). A folder of its own is a place to
   put them, not a wider reach. The user manual says where the folder is and when it goes.

3. **Amends ADR 0184 decision 4: code a program downloads is pinned by hashes in the plugin's
   release.** ADR 0184 says a `programs` script "is fixed at install". A launcher that downloads
   and runs code keeps that fixed **in substance** only on one condition. The plugin's release
   commits the exact list of what it will fetch: name, version, address and the registry's
   `sha512` integrity for each package. The launcher refuses anything whose hash differs, as it
   refuses an absolute path, a `..` segment or a link inside a package. What runs is then
   decided by the version of the plugin the person installed. A new version of the downloaded
   code needs a new plugin release, which an update brings like any other change. Tyto does
   not check this: the host never reads the script (ADR 0184 decision 4). It is the rule a
   plugin follows, and the agent panel follows it. **A program that downloads code nobody
   pinned breaks the trust ADR 0184 asked the person for**, and a review refuses it.

## Consequences

- The agent panel can fetch the Claude ACP adapter on first use into
  `<home>/data/plugins/agent/` and run it from there. Nothing of the SDK enters a repository, and
  the download survives the plugin's updates.
- A program written for an older Tyto sees no `TYTO_PROGRAM_DATA`. It must say that it needs a
  newer Tyto rather than guess a folder.
- The CLI starts no programs (`E_PROCESS_UNAVAILABLE`), so it never sets the variable.
- `docs/plugin-api.md` and the user manual (customize › plugins, both editions) say where the
  folder is and that it goes with the plugin.

## Alternatives rejected

| Alternative                                               | Why not                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Download through `host.fetch` and keep it in `host.cache` | The cache holds bytes under keys, not a tree a program imports, and it stays after the plugin goes    |
| Keep the download inside the plugin's own folder          | An update replaces that folder whole: every new version would download again                          |
| The script works out a folder from its own path           | Ties every plugin to Tyto's layout, and nothing removes what it wrote                                 |
| `TYTO_PLUGIN_DATA` as the name                            | `TYTO_PLUGIN_*` is the prefix the allowlist keeps out as the plugin's secrets; one rule, no exception |
| A permission of its own for the folder                    | The program already reaches the person's files; the folder widens nothing                             |
| Give the folder only to a plugin's own program            | A program from `PATH` is the plugin's too; one rule for both is one thing to explain                  |

## Left open

| What                                                | Why it matters                                                     | Status      | Card     |
| --------------------------------------------------- | ------------------------------------------------------------------ | ----------- | -------- |
| The agent panel's launcher, lock and download offer | Until it lands, nothing uses the folder                            | Not built   | TYTO-666 |
| `testPlugin` offering a stand-in data folder        | A plugin author tests a program's folder by passing one themselves | Not built   | —        |
| A size limit on the data folder                     | A program may fill the disk, as any program the person runs may    | Not decided | —        |
