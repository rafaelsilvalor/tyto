---
'@tyto/core': minor
---

Inline markup in a frontmatter scalar is now a warning (E3.5).

`titulo: Direito **Constitucional**` in the frontmatter renders the asterisks, where the
same words after `::titulo` come out bold. The scalar is still accepted — a one-line title
is why the frontmatter carries scalar slots at all — but a rich-text slot set that way now
reports `W_MARKUP_IN_FRONTMATTER`, naming the markup it found and the directive to write
instead.

Warning rather than error, because the brief still means something; and not parsed, because
`core` may not import `brief-lang` and moving the inline layer is a larger decision than
this one.

The detector is a second and cruder reader of the inline syntax, so it errs quiet: two
asterisks before it calls something italic, a `{/}` before it calls something a mark, and
the backslash last. `Promo 2 * 3 vagas` is not a warning.
