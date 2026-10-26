# 0143 — Vim plugins are switched by an open setting and ship as a built-in

Status: accepted · 2026-10-26 · TYTO-418 · builds on ADR 0141, ADR 0142, ADR 0073 and ADR 0092

## Context

ADR 0141 gave plugins the `editor.vim` point and left two things to TYTO-418: wiring the window
to the registry, and the `vimPlugins` setting that decides which contributions are on. This card
also ships the first real contribution, vim-commentary, through the built-in plugin.

`@replit/codemirror-vim` 6.4.0 **already maps `gc`**: an operator, `toggleComment`, that runs
CodeMirror's `toggleLineComment`. So `gcc`, `gc{motion}` and visual `gc` work in a brief with no
plugin at all. What it does not do is a block comment: in a Markdown file or a template, whose
languages have only `<!-- -->`, vim's `gc` does nothing.

## Decision

1. **`vimPlugins` is an object of booleans with an open key.**
   `z.record(z.string().min(1), z.boolean())`, each member checked on its own (`members`, as
   `statusBarColors`), so a switch that is not a boolean is a warning at its value and only that
   plugin falls back. The key is not an enum, because an installed plugin's contribution is
   switched by its own id, which the settings tab cannot know in advance. The tab's `options`
   name the built-in ids (`commentary`, and `surround` before its contribution lands).

2. **Every vim plugin is on unless the setting says `false`**, built-in and installed alike
   (Rafael, 2026-10-26). The default is `{}` and the window resolves `value[id] ?? true`. The file
   replaces the object whole, as every object setting does, so a person writes only the ones they
   turn off. A plugin that should start off (sneak, TYTO-419) is the exception that will need its
   own rule; this ADR does not give it one.

3. **The built-in vim plugins are `editor.vim` contributions of the `desktop` built-in plugin**,
   registered with `registerVim` beside its settings and themes, and its manifest declares
   `"editor.vim"`. Their data lives in `apps/desktop/shared/vim-plugins.ts`, which both halves read.

4. **The window reads them on a new channel, `plugins:vim`.** Main answers the built-in host's
   `registry.vim()` followed by the installed plugins' (`windowPlugins().vim()`), after the
   plugins have started, as `plugins:keymaps` does. Built-ins first means that when an installed
   plugin maps the same keys in the same context, the window keeps the built-in's and refuses the
   second (ADR 0141 decision 3). The setting rides `theme:current` like `lineNumbers`, so a save
   switches a plugin in place; `setVimContributions` is diffed, so the many answers that change
   nothing change nothing in the engine. Refusals (`E_VIM_CONTRIBUTION`) go to the log, once per
   change.

5. **Commentary is a contribution on `gc` with no context, mapped onto a new `comment`
   operator** in `@tyto/editor` that runs CodeMirror's `toggleComment`, which reads the
   language's `commentTokens`: a line comment where the language has one, a block comment where it
   has only that. Being an operator, `gcc`, a count, any motion or text object, visual `gc` and
   `.` come from the engine. **Switched off, `gc` is vim's own again**, because unmapping our entry
   lets the dispatcher find the default (ADR 0141 decision 2). The measurable difference is a
   block-comment language: on, `gcc` wraps the line in `<!-- -->`; off, it does nothing. Wiring
   only the switch to vim's `gc` would have made "off" and "on" the same in a brief and both
   broken there.

   **In the window that language is Markdown**, a `.md` tab: a `template.html` opens in template
   mode, whose editor has no vim at all. And Markdown's `<!-- -->` never reached CodeMirror: the
   `Language` wrapping `@lezer/markdown` (ADR 0132) did not attach its facet to the tree's top
   node, where `toggleComment` looks, so it found no comment tokens. The parser now carries the
   facet as `languageDataProp` on `Document`. Measured in the window before the fix: `gcc` on a
   Markdown line changed nothing with commentary on.

6. **The adapter carries two more things from a contribution to the engine**, both for
   surround (TYTO-418 PR B):
   - an operation that declares `isEdit: true` has it passed on `mapCommand`'s extra, on the
     keymap entry, where the engine looks before it records the edit for `.`. An operator is
     recorded anyway; an action was not, which is the consequence of ADR 0141 this replaces;
   - `selectedCharacter`, the key a `<character>` in the mapping's keys stood for, is no longer
     filtered from the args, so `ys{motion}<character>` reaches the operation with the pair.

   And it clips an engine position to the document, as CodeMirror 5's were. A linewise operator
   that reaches the last line (`gcG`, visual `VG` then `gc`) is handed the start of the line
   after it, which the document does not have; unclipped, any contributed operator threw a
   `RangeError` there. Measured: three of the six commentary cases throw without the clip.

## Consequences

- A person who wants vim's `gc` with no block comments writes `"vimPlugins": { "commentary":
false }`. In a brief the two behave alike.
- An installed plugin's vim keys are on the moment it is installed, with nothing to write.
- A `surround` switch is documented before surround ships, so the key written today is the one
  that works when it lands; until then it switches nothing.
- The settings tab cannot suggest an installed plugin's id; it suggests the built-ins' only.
- Template mode's editor takes no vim, so `gc` in a template's markup is out of reach until it
  does; the editor's template language already answers `<!-- -->` to the operator.
- What the real window shows of `gcc` is measured once, by hand, in a `.md` and a `.brief` tab;
  jsdom covers the key sequences.
