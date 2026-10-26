# 0141 — A plugin contributes vim mappings as data

Status: accepted · 2026-10-25 · TYTO-417 · builds on ADR 0006, ADR 0007, ADR 0041 and ADR 0074

## Context

Batch `vim-plugins` brings well-known vim plugins (surround, commentary and others) into Tyto's
vim mode, each switchable from `settings.json`. "Built-in is a plugin" (CLAUDE.md) means they
arrive through an extension point of `plugin-api` that the built-in plugin uses like any third
party, so the point comes first.

Vim mode is `@replit/codemirror-vim` 6.4.0, mounted by `packages/editor/src/vim-mode.ts`. Its
registrations are **global to the module**: one keymap array, one table of actions, one table of
operators and one of ex commands, however many editors the window has. `vim-mode.ts` survives
that by having each handler find its editor through the view it is handed, never by closure.

A vim key runs synchronously against the document, in the renderer. The plugins that contribute
keys run elsewhere: a built-in in the main process, an installed one in its own process behind
the message boundary (ADR 0041).

## Decision

1. **The point is `editor.vim`, and it is data only.**
   `{ id, title?, mappings: { keys, context?, operation, args? }[], ex?: { name, shortName?, command }[] }`.
   `context` is one of vim's own `normal`, `visual`, `operatorPending`, `insert`; absent, the
   mapping applies wherever the engine applies an uncontexted one. A mapping names an
   **operation** that `@tyto/editor` implements and registers with `defineVimOperation`, as an
   action (runs on its keys) or an operator (waits for a motion and is handed the ranges it
   covers). `args` are the plugin's own parameters, handed to the operation as they are. In the
   isolation table the point has a strict data schema and no callables.

   The alternative was a callable, `apply({ text, ranges, args }) → edits`, crossing as an async
   handle. **The round-trip was not measured, by reasoning:** whichever process the plugin is in,
   it is not the renderer, so a callable is a message across a process boundary on every
   keypress, and an operator that waits on one is the failure the card names. Data crosses once,
   at registration. The cost is that a plugin cannot invent a new kind of edit; it can only map
   keys onto the operations the editor has. The operations that batch `vim-plugins` needs are
   added to `@tyto/editor` by its later cards.

2. **Switching is per window, not per editor.** `setVimContributions(contributions, enabledIds)`
   is one module-level call. Operations are registered into the engine by name once, under a
   `tyto:` prefix so a name cannot replace one of vim's own. A contribution switched on has each
   mapping `Vim.mapCommand`ed; switched off, each is `Vim.unmap`ped. The call is **diffed against
   what is applied**, so the same answer twice changes nothing, and a contribution whose data
   changed is unmapped and mapped again.

   The card proposed one registration gated per view by a facet in a compartment, the way
   `indentGuides` is. That gate cannot give a key back: the engine matches a mapping before any
   handler runs, so a switched-off `S` or `ys` would still match and be swallowed by a handler that
   does nothing, instead of falling through to vim's own command. Unmapping does give it back:
   `mapCommand` puts the new entry ahead of the defaults (`_mapCommand` unshifts it), the
   dispatcher takes the first full match, and `unmap` removes that entry, so the default is found
   again. The test "gives vim's own key back when it is switched off" measures it on visual `S`.
   **Two editors in one window with different switches are therefore not supported**, on
   purpose: the engine has one keymap, and the setting that drives it (TYTO-418) is the window's.

3. **`Vim.unmap` removes the first entry with the same keys and context**, whoever put it there.
   So two enabled contributions may not map the same keys in the same context; the second is
   refused. Otherwise switching one off could remove the other's mapping.

4. **An ex command, once defined, stays defined.** The engine has `defineEx` and no way back.
   The handler looks up, when it runs, whether an enabled contribution holds that name, and does
   nothing when none does. A plugin's ex name that collides with one of vim's own replaces it in
   the engine; nothing refuses that yet.

5. **A contribution that cannot be applied is left out whole**, as `E_VIM_CONTRIBUTION`, non-fatal
   (ADR 0025): an operation the editor does not have, empty keys, an unknown context, an action
   mapped in `operatorPending` (the engine never runs one there), keys or an ex name another
   enabled contribution holds, or an ex `shortName` that is not a prefix of its `name` (which
   `defineEx` would throw on). Half of a plugin's keys landing would be harder to explain than
   none. The diagnostics ride the ok branch beside the ids that were applied.

6. **The editor does not depend on `plugin-api`.** `@tyto/editor` repeats the contribution's
   shape structurally (`VimContribution`), as it does `EditorKeymap`; the composition root hands
   one to the other.

## Consequences

- A plugin of batch `vim-plugins` is a manifest that declares `editor.vim` and registers data;
  the operations it maps onto are code in `@tyto/editor`, reviewed with the editor.
- Wiring the window to `registry.vim()` over IPC, and the `vimPlugins` setting that decides the
  enabled ids, is TYTO-418. Until then nothing in `apps/` reads the point.
- A switched-off ex command still answers `:name`, silently. A person typing it gets no
  "not an editor command" message.
- Dot-repeat of an action is not wired: a mapping does not mark itself as an edit, so `.` repeats
  the edit before it. The first plugin that needs it adds the flag.
