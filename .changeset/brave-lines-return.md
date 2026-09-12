---
'@tyto/brief-lang': patch
---

A brief parses whatever line ending wrote it (E3.6).

`parseBrief` accepted the newline and nothing else. A file saved on Windows failed at the
frontmatter fence and then cascaded — every directive after it reported incomplete, with no
diagnostic mentioning line endings, so an author read "unexpected `---`" about a `---` that
was plainly correct.

The endings are read by the grammar rather than normalised away first. Normalising moves
every offset by one unit per line, and a `Diagnostic.range` indexes the text the caller
handed in: an editor highlighting a range computed against a shorter string would underline
the wrong characters in a Windows buffer. So the tokens learned the other two endings,
offsets stay the caller's, and `createLineIndex` in `@tyto/core` already counted all three
as one line end — line and column came out right as soon as the offsets did.

Three other places had the same assumption and were fixed with it: the frontmatter
tokenizer scanned for the newline by hand, `bodySpan` searched for one to find the fences
(a classic-Mac file contains none, so the body started at offset 0 and the fence itself
parsed as YAML), and the `Break` node between two lines of an indented block had a
hardcoded one-unit span that covered half of a two-unit ending.

Inside the frontmatter there is one substitution: `yaml` ends a line on the newline and on
the pair, but not on a lone carriage return, so those are swapped before it parses. One code
unit for one, so no offset moves — the trap above stays shut.

`@tyto/template-lang` was measured and needed no change: its whitespace token already took
the carriage return, and `@skip` drops it everywhere. A test records that rather than
leaving it assumed.
