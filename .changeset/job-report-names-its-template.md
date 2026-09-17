---
'@tyto/pipeline': minor
---

TYTO-121 — `JobReport` says which template the run used

One optional field, `template`, carrying the manifest of the template the job actually
loaded. Absent when the run never got that far: a brief that does not parse, or a name no
registry has.

**Nothing else could answer it.** The name is the brief's frontmatter or the `--template`
fallback, and applying that precedence is the job's own rule — a caller that wanted the
answer had to duplicate it, which `job.ts` already says once is one time too many.
`result.json`'s `tyto.templates` is a different question: it lists every template that was on
the search path, so on a project with two templates it answers two names.

The manifest rides along whole rather than copied field by field, because the point is to
**name** a template rather than to carry one — a delivery that duplicated the template it used
would fill a remote with copies of a file that has one home.

A cancelled run carries it too, as soon as the template stage has loaded one: "which template
was this going to be" is as true then as it is at the end.
