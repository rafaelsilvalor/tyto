---
'@tyto/editor': minor
---

The template language in the editor (TYTO-39).

`template()` is the second `LanguageSupport` this package ships, and `createEditor` takes
`language: 'brief' | 'template'` to choose between them — a name rather than a
`LanguageSupport`, so a host still never imports CodeMirror. It is fixed for the life of an
editor: a buffer is a `.brief` or a `template.html`, and opening the other one is opening
another file.

The grammar is the one `compileTemplate` parses with and the colours are
`templateHighlighting`, which lives beside it. Folding collapses an element to its opening
tag, a rule to its selector and the whole stylesheet to `<style>`. Both themes grew the
palette the second language needs — and four tags turned out to be shared with the brief
outright, which is the tag vocabulary doing its job.

`templateLint(analyzer)` puts `compileTemplate`'s diagnostics in the gutter, with a quick
fix for a name edit distance can reach. `templateCompletion()` offers tag names after `<`,
the attributes the tag being written accepts, and CSS properties inside `<style>` — out of
the same arrays the compiler refuses against, so a name the editor offers is a name the
compiler accepts by construction.

`createTemplateAnalyzer({ manifest })` is the port, and it takes **the template's own**
manifest rather than a registry: a brief names its template in the frontmatter, a
`template.html` is the file beside a `manifest.yaml`, and only the host knows which.

The demo now opens all four built-in files — two briefs and two templates — and the
diagnostic-to-marker mapping the brief linter had is shared with this one rather than
written twice.
