# 0020 — A template pack is a directory, and the project shadows it

Status: accepted · 2026-09-13 · applies ADR 0007 and ADR 0010 to E4.11

## Context

`promo-curso` and `carrossel-lista` have shipped under `packages/templates/templates/`
since TYTO-25, in the package's `files`, and they work the only way a template works today:
`--templates <dir>`. Somebody who installs Tyto and wants what came with it has to know
where on disk those files landed, which is the sort of thing a program should know about
itself.

TYTO-25 stopped there deliberately, and `templatePackPlugin` has registered an empty pack
ever since, saying so in its own doc comment. Two questions were left, and neither has an
obvious default.

**How does a pure package expose a folder?** `@tyto/templates` may not import `node:fs`
(ADR 0010, and lint enforces it), and a `?raw` import is resolved by a bundler in tests and
by nothing in `dist`. The folder is not only manifests either: rendering reads
`template.html` and the `src=` files beside it, so anything that inlines the manifests
alone answers half the question.

**What happens when both sources offer `promo-curso`?** `loadTemplateRegistry` already
treats a duplicate name inside one root as a failure on the second folder, so that
resolution does not depend on the order the filesystem listed them in. Two sources is the
same collision with a different cause — and unlike directory order, the order of the
sources is something we choose.

## Decision

### A pack is a directory, and the composition root finds it

`@tyto/templates` stays pure and stays a folder of files. It exports one thing,
`BUILT_IN_TEMPLATES_DIRECTORY`, the name of its own subfolder, so that the string lives in
the package that owns it. It adds `"./package.json"` to its `exports`, which is what makes
the package locatable from outside.

`apps/cli` resolves the installed path, because resolving a path is Node work and ADR 0010
puts Node work in the composition root:

```ts
const here = createRequire(import.meta.url).resolve('@tyto/templates/package.json');
const directory = join(dirname(here), BUILT_IN_TEMPLATES_DIRECTORY);
```

This is the third of the three candidates the card listed, and the other two were rejected
on mechanism rather than taste:

- **Inlining the manifests through a tsup loader** keeps the package pure and answers the
  registry's question, but `compile` still has to read `template.html` and the template's
  assets off a disk. It would leave the pack half-resolved and the other half still open.
- **Making `@tyto/templates` a Node package** so it can resolve its own directory is a
  one-line change to the package and a hole in the rule that makes the cloud possible
  later. The pack's _contents_ are data; only locating them needs a runtime, and exactly
  one place in this repository is allowed to have one.

`createRequire(...).resolve` works in a workspace (through the symlink), in a published
install, and inside an Electron `asar`, where Electron patches both the resolver and `fs`.
That last case is the one the card asked about and it is the reason the path is resolved
from the package's own `package.json` rather than assembled from a guess about
`node_modules`.

### The pack reaches the registry through the extension point

`templatePackPlugin` now registers a real `TemplatePack` — the manifests read from that
directory, and the directory itself. The template registry is then built from what the host
holds, not from a path passed around it. A pack that is registered and not read would be an
extension point nobody could tell was broken, which is the thing ADR 0007 exists to
prevent.

**Its host is the project's, not the render's.** `activateBuiltIns` builds a host per
render, because an exporter binds the bytes of the folder it is rendering and two tasks in a
`tyto watch` have different `assets/`. A template pack has no such tie: it is read once with
the rest of the project, in `loadRenderContext`, and re-reading every manifest per task
would make the second render slower than the first for no reason. So the pack moves to a
host with the context's lifetime, and `activateBuiltIns` stops registering the empty one.

### The project shadows the pack, and says so once

`loadTemplateRegistry` takes an ordered list of roots. **Earlier wins**, and the CLI passes
the project's `--templates <dir>` first. A user's own `promo-curso` is the one that renders.

Three reasons, in the order they decided it. A folder the user pointed at is a more specific
statement of intent than a package that came along with the program — the same rule
`node_modules` resolution and every editor's settings cascade already use. Overriding a
built-in is a stated goal of the card. And the alternative that refuses the collision
outright would make the built-in pack a liability: adding a template to `@tyto/templates`
in a later release could break a project that had been working for months.

**A shadow is a warning, not silence and not an error.** `W_TEMPLATE_SHADOWED` names both
directories, rides the `ok` branch (ADR 0013) and fires only when the names actually
collide. Silence was rejected because "my edit to the built-in did nothing" and "why does
mine look different on this machine" are the two questions this rule will generate, and one
line in `result.json` answers both. It is not an error because nothing is wrong: the run
produced the template the user asked for.

**A duplicate inside one root stays an error.** `E_TEMPLATE_DUPLICATE` is unchanged, and the
distinction is the whole point: two folders in one directory have no order anybody chose, so
picking between them would be arbitrary. Two roots have an order this ADR chose.

## Consequences

`tyto render` finds `promo-curso` with no flag. `--templates` keeps working and keeps
meaning exactly what it meant; it is now an addition to the search path rather than the
whole of it, and a project with no `templates/` folder at all no longer fails to load a
registry.

`loadTemplateRegistry`'s signature widens from `root: string` to
`roots: string | readonly string[]`. The string form is kept and behaves exactly as before —
every existing caller is one root, and the desktop app is not built yet.

The missing-directory rule changes shape. A single root that cannot be read is still an
`Err`, because a caller with one root and no folder has no registry to be given. With
several roots, one unreadable root is an `Err` only when **every** root is unreadable;
otherwise it is a failure on that root.

**And the CLI drops one of those failures, the default `templates/`.** A project without
one now renders from the pack, so a complaint about a folder the user never mentioned would
open every such run. A folder they did type and do not have is still reported, which means
the CLI has to know the difference — commander's `getOptionValueSource` does, and
`loadRenderContext` takes it as `templatesDirectoryIsDefault`. It is the one place in this
change where the flag's _origin_ matters and not its value.

A root listed twice is de-duplicated before the search, by exact string equality. Without
that, `--templates <the pack's own folder>` — the documented pre-0020 way of using the
built-in templates, which still has to work — would report every template in it as shadowed
by the copy of itself. Exact equality rather than path normalisation because the registry is
pure and `C:\x` versus `c:/x` is a filesystem's opinion; callers resolve to absolute paths,
which is what makes it enough.

What this does not decide: how a _third-party_ pack is installed and located. That is the
plugin loader (E11.1). This ADR says what a pack is and how one merges; it says nothing
about where an uninstalled one comes from, and the mechanism here — a directory registered
through `registerTemplatePack` — is deliberately the same one a loaded pack will use.
