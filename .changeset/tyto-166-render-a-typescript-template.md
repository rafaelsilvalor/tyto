---
'@tyto/pipeline': minor
'@tyto/templates': minor
'@tyto/core': patch
---

TYTO-166 — ADR 0005 gave a template two routes and only one of them ran. A template whose body
is code could be written, and nothing could draw it.

**The gap was narrower than it looked.** `compile` already executes any `Template`; it calls
`template.build(context)` and does not care where the object came from. What was missing was
the wiring that hands it one: both composition roots composed `markupTemplateSource` and no
other source.

**`bundledTemplateSource` is that wiring, and it is not a loader.** Nothing reads a path,
imports a module or executes anything a scan discovered. It serves code the build already
holds — a first-party template compiled and shipped with the application, exactly like the
built-in pack — and pairs each function with the manifest the registry already parsed.

The refusal it does not touch stays where it was: running code that arrived in a folder is the
plugin host's job, with its permissions and its isolation (ADR 0007). A `template.ts` dropped
into a template directory is inert, and there is a test that says so rather than a comment.

**The manifest stays YAML and a module never declares its own.** The registry answers what
templates exist and what each declares without importing a line of template code, so a picker
can list templates nobody asked to run; a manifest written in TypeScript would make opening
that picker execute every template on the machine. So a module contributes only its `build`,
and the two meet in the source, which is the first place that has both.

**A name with two bodies is refused rather than resolved.** Shipped code plus a `template.html`
in the same folder is the new `E_TEMPLATE_AMBIGUOUS`. It is not `E_TEMPLATE_DUPLICATE`, which
is about two folders: the registry sees one manifest here and is right to, so only whoever
loads the build can notice. A silent winner would be a template that changes behaviour the day
somebody edits the file it was ignoring.

**Measured.** 63 tests in `@tyto/pipeline`, including two that drive `runJob` end to end with a
code template — real parser, real `resolve`, real `compile`, shipped exporters — to PNG and
SVG. The three promises of the new module were perturbed to prove the suite protects them:
skipping the ambiguity check reddened **1 of 61**, returning a wrapper instead of the function
that was handed over reddened **1 of 61**, and answering the unknown-manifest case here instead
of delegating reddened **1 of 61**.

**Composed in three places**, so the window and the terminal agree: the CLI's `templateWiring`,
the desktop's export path, and the desktop's preview. A preview that could not draw a code
template would send somebody to the CLI to find out whether their work rendered.

**`BUILT_IN_TEMPLATE_BUILDS` ships empty**, and `@tyto/templates` gains `@tyto/core` as a
dependency because a template written in TypeScript imports the SDK by necessity. The first
entry is the Agenda carousel (TYTO-167). A pack that shipped a code template before anybody
had written one would be the mistake ADR 0022 recorded about itself.

**`W_UNUSED_SLOT` cannot fire on this route**, and `docs/template-authoring.md` now says so.
`renderedSlots` is derived by reading a markup body; a function has no body to read, so
`resolve` is told nothing rather than told "none". The silence means _nobody checked_, not
_every slot is drawn_.
