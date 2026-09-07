---
'@tyto/core': minor
---

Add the template manifest schema and `TemplateRegistry`.

`templateManifestSchema` and `parseManifest(source, path)` validate a `manifest.yaml`,
reporting every problem in one pass with the YAML path of the offending key and the range
of the value under it. Beyond the shape it enforces the rules a shape cannot state: one
repeatable slot per manifest, enum values and defaults, `applies` naming a declared slot,
and slot names the brief language can actually write.

`loadTemplateRegistry(fileSystem, root)` discovers templates by folder through the new
`FileSystem` port, reading manifests and never `template.ts` or `template.html`. It
exposes `list()`, `get()`, `formatsOf()` and `directoryOf()`, and keeps per-folder
failures beside the templates that loaded.

New diagnostic codes: `E_MANIFEST_SYNTAX`, `E_MANIFEST_SHAPE`, `E_TEMPLATE_DUPLICATE`,
`E_TEMPLATE_READ`.
