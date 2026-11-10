---
'@tyto/command-line': minor
---

`tyto mcp` serves what each template's folder says about writing a brief for it (ADR 0186): its
`guide.md` and its `examples/*.brief` as resources, capped and cut with a line that says so, and
the `model_brief` prompt, which puts generic steps, the template's slots, skeleton, guide and
examples in front of the copy. A restricted folder's own templates serve neither.
