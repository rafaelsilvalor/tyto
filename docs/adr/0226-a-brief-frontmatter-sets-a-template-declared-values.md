# 0226 — A brief's frontmatter sets a template's declared values

Status: accepted · 2026-11-22 · TYTO-833 · amends ADR 0153 decision 2; builds on ADR 0151

## Context

ADR 0153 lets a template declare the values a configuration may change (a colour, a length, a
number, a face, an image), each with a default, and `compile` hands them to the template as
`context.values`. A value has come from one place only: a plugin file's configuration (ADR 0151,
TYTO-439), one entry per variant.

The maintainer's remarketing ads change their accent colour with every exam, and there are dozens
of exams a month (2026-11-22). One configuration per colour is a file nobody wants to keep; the
colour is a fact of the piece, like the exam's name, and belongs in the brief that describes it.

## Decision

1. **A frontmatter key that names a value the template declares sets that value**:
   `destaque: '#e30613'`. Any kind but an image (point 4). No template code: every template that
   declares values gains this.

2. **The brief wins over the configuration, which wins over the default**, value by value. A
   value the brief does not set keeps the configuration's, or the default. `CompileOptions.values`,
   which only tests and API callers pass, stays over everything, as before.

3. **A slot keeps its name.** A key that is a slot is still the slot, even if a value has the same
   name; a key that is neither is still `E_UNKNOWN_SLOT`. A value the template cannot take keeps
   ADR 0153 decision 3: `W_TEMPLATE_VALUE_INVALID` at the frontmatter key, and the default
   stands. An unquoted hex colour reaches the template empty, because YAML reads `#` as a comment;
   its warning says to write the quotes.

4. **An image value is not set from the frontmatter yet.** A brief's image goes through the
   brief's own asset resolution, a different path from the one that reads a configuration's
   image from the template's files. Writing one is `W_TEMPLATE_VALUE_INVALID` naming that, and a
   configuration still sets it. Its own card when somebody needs it.

5. **The editor offers the declared values as frontmatter keys**, each with its kind and default,
   an image left out; a colour's completion writes the quotes.

## Consequences

- A template's declared values are now part of the brief's vocabulary. Their names are the
  template author's choice, as slot names are; a template written for Portuguese-speaking
  authors names them in Portuguese (`destaque`, not `accent`).
- Every value set in a brief crosses to a template in its plugin's process with the
  configuration's, through `resolved.values`: no new path.
- A brief can now break a template's colour harmony one piece at a time; a template that cares
  (anuncio's contrast between its accent and the band's words, TYTO-836) warns about it itself.
