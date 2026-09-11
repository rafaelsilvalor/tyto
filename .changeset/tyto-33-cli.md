---
'@tyto/core': minor
'@tyto/pipeline': minor
'@tyto/io': minor
---

TYTO-33 — what the `tyto` command needed from the packages under it.

`core`: `ResolveOptions.formats`, the `--formats` flag's way in. It is a **fallback and not
an override**, mirroring `ResolveOptions.template`: the frontmatter's `formats` still wins,
so there is one rule for a reader rather than two. A format it names that the manifest does
not render is the same `E_UNKNOWN_FORMAT` the frontmatter would get, with no range attached
because a flag is not a position in a file. New diagnostic code `E_INPUT_READ`, for a file a
command was pointed at and could not open — `E_TEMPLATE_READ` was the nearest thing and its
summary is about templates.

`pipeline`: `JobRequest.formats`, passed straight to `resolve`. The job does not filter
frames afterwards — a frame nobody asked for should never be built, not built and dropped.

`io`: `fsTaskOutput(directory)`, the `TaskOutput` over one folder that `fsOutbox` is now
written in terms of. `tyto render --out <dir>` writes into exactly the folder it was given
(`docs/integrations.md`), while the outbox derives `<root>/<id>/out` from a task id; the
atomic write underneath is the part neither may have its own copy of. Also
`fileTemplateAssets(...)`, which reads the files beside a `template.html` that its `src=`
attributes name — `markupTemplateSource` has always left that to whoever composes it, and
before this nothing did, so a template with a `<vector src>` could not render.
