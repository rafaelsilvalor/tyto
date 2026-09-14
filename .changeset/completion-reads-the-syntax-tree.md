---
'@tyto/editor': minor
---

TYTO-93 — completion reads the syntax tree, in both languages

Both completion sources used to decide where the cursor was by matching the text before it
with a regular expression. That made the editor a second reader of a syntax this repo already
ships a parser for, written twice — once for the brief, once for the template. Both now walk
`syntaxTree(state).resolveInner(pos, -1)` and answer by node.

What changes for somebody writing a file:

- `slot="…"` inside a `<text>` or an `<image>` now offers the slots the active manifest
  declares, with each slot's type beside it. Pointing the editor at another manifest changes
  the list. `templateLint` publishes that manifest to the editor state, so the squiggle and
  the completion list are always talking about the same template.
- A `<` typed inside an attribute value is a character in a value and no longer offers the
  tag list, and a `::` on an indented body line is body text and no longer offers the slot
  list. Both were cases a regular expression had to be taught by hand.
- A `>` already written puts the cursor outside the opening tag, so attributes stop being
  offered in an element's body; a property is offered at the start of a declaration and not
  where a selector goes.

`TemplateAnalysis` now carries the `manifest` it was computed against, and
`templateAnalysisField` / `setTemplateAnalysis` are exported beside the brief's equivalents.
A host that mounts `templateCompletion()` without `templateLint()` keeps everything but the
slot list.

One text match survives, in each language, and both are places the grammar leaves nothing to
read: the brief's frontmatter is one opaque token whose YAML a real parser handles elsewhere,
and an unterminated attribute value in a template is an error node with no structure under
it. The tree still says which frontmatter block and which attribute, which is the part that
used to be guessed.
