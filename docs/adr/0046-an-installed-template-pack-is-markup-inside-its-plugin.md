# 0046 — An installed template pack is markup, inside its plugin

Status: accepted · 2026-09-27 · TYTO-50 · extends ADR 0020 and ADR 0041 to installed packs ·
amended by ADR 0048, which lets a code template run in its plugin's process

## Amended by ADR 0048

"An installed pack holds markup templates only" no longer holds. A folder with no
`template.html` is a code template, drawn by the pack's `build` in the plugin's process
(TYTO-189). What is still refused, as `E_PLUGIN_PACK_CODE`, is a `template.ts` in the folder
and a code template in a pack with no `build`. The rest of this ADR stands.

## Context

`template-pack` was a contribution point with one contributor, the built-in pack, activated in
process by the CLI with a path the CLI itself resolved (ADR 0020). E11.1 let an installed plugin
register one, and E11.2 moved that plugin into a worker thread, where a pack crosses as data:
`{ id, templates, directory }` (ADR 0041). Nothing read it. `loadRenderContext` built the
template registry from a host holding the built-in pack alone, and installed plugins were
activated only into each task's host, which nobody asks for templates. An installed pack
installed cleanly, was listed as `enabled`, and every brief naming one of its templates was
`E_UNKNOWN_TEMPLATE`. TYTO-50 found it while writing the first example pack.

Wiring it in raises two questions the built-in never did. Its `directory` is a string another
party's code wrote, in another thread. And a template folder can in principle hold code.

## Decision

**The CLI searches installed packs after the built-in one**: the project's `--templates`, then
the built-in pack, then each installed pack in the order the plugins were loaded. That is ADR
0020's order with ADR 0040's rule that a built-in keeps what it has. A name an earlier source
already holds is `W_TEMPLATE_SHADOWED`, with the wording ADR 0020 gave it.

**A pack's `directory` is relative to the plugin's installed folder, and may not lead out of
it.** An absolute path (whether POSIX, a drive letter or a root, on any platform), a `..` that
climbs out, a folder that does not exist, and a link whose real path is outside are all refused
with `E_PLUGIN_PACK_DIRECTORY`. Both ends are compared after `realpath`, so a link is judged by
where it lands. Nothing is decoded: `%2e%2e` is a folder name, and one that does not exist is
refused as missing. A plugin writes `directory: 'templates'` and needs no `node:url` to find its
own folder.

**An installed pack holds markup templates only.** Every folder in it that has a `manifest.yaml`
must have a `template.html` and no `template.ts`. Anything else is `E_PLUGIN_PACK_CODE`, naming
the plugin and the template. Today nothing loads code from a folder at all (ADR 0007). A
`template.ts` there is never imported, and a name without `template.html` is either shadowed by
the built-in that ships it or fails to load. So this rule does not close a door that is open
now. It fixes the boundary before one opens: a code template from a plugin's folder would be
imported by the CLI or by the desktop's main process, and would run with Tyto's privileges and
not behind the plugin's thread.

**A refused pack refuses the plugin.** Both codes reach a render as `W_PLUGIN_SKIPPED`, and the
plugin is kept out of every task's host as well. Its exporter or directive is not offered either,
because a warning that says a plugin was skipped would be false if the same plugin then drew the
frames.

The check reads the disk, so it lives in `packages/io/src/installed-packs.ts` and not in
`@tyto/plugin-api`, which is pure (ADR 0010). The CLI and the desktop both call it, so the rule
has one text. (It lived in `apps/cli` until the second TYTO-50 pull request wired installed
packs into the desktop's template sources and picker; the decision is unchanged.)

## Consequences

- The contribution's `templates` list is not read for an installed pack. The host reads the
  manifests from `directory` with the same parser a project's templates go through, so a plugin
  sends `templates: []`. A pack that listed manifests its folder does not hold would otherwise
  offer templates nothing can render.
- Each installed plugin is activated once more per process, into the project's host. That costs
  one message round trip per plugin, measured by nobody, against a render's hundreds of
  milliseconds.
- A pack contributes no `formats.yaml`. Its templates' format ids have to be in the project's,
  which is why the example pack and the scaffold ship one to copy from.
