---
'@tyto/editor': patch
'@tyto/template-lang': minor
---

Quick fixes reach the three cases they were missing (TYTO-92).

**An adjustment that carries a value is fixable.** `E_BAD_ADJUSTMENT` is ranged over
`name: value` for an enum, and the whole-range guard refused it rather than rewrite the
author's value. The editor now cuts at the first colon — exact, not approximate, because
the grammar forbids a space in front of one — and replaces only the name: `{tomm: claro}`
becomes `{tom: claro}`.

**A property the alias table knows gets a button, not only a message.** `background` is not
a typo of anything, so no edit distance would ever find `fill`.
`@tyto/template-lang` now exports `propertyAlias`, `tagAlias` and `attributeAlias`, each
filtered to the entries that name exactly one accepted thing — the multi-word ones ("x, y
and rotation") stay in the message, which is where a sentence belongs.

**An attribute on the wrong tag gets one too.** Which attributes are legal is a question
only the tag answers, and `E_UNSUPPORTED_ATTRIBUTE` does not carry the tag as a field. The
editor climbs from the diagnostic's range to the enclosing `Element` in the tree it already
has, rather than the diagnostic growing a field for one consumer. `object-fit` is offered as
`fit` on an `<image>` and refused on a `<rect>`, which does not take it.

Also: the editor's test run no longer prints a jsdom `TypeError` from CodeMirror's measuring
pass on every test that draws a marker.
