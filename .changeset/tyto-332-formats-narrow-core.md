---
'@tyto/core': minor
'@tyto/pipeline': patch
---

Requested formats now narrow the brief's own list instead of being ignored (TYTO-332, ADR 0107). `ResolveOptions.formats` on a brief whose frontmatter lists formats keeps the listed ones it also names, in the brief's order; a requested format the template renders but the brief does not list is the new non-fatal error `E_FORMAT_NOT_IN_BRIEF`, on the frontmatter's `formats` line. A brief with no list is unchanged. `listedFormats` is exported: the frontmatter's `formats` as a list, a scalar read as a list of one.

**Behaviour change for callers that pass `formats`:** a brief listing `[feed, story]` resolved with `formats: ['feed']` now renders `feed` only, where it used to render both.
