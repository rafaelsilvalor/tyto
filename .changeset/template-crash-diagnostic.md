---
'@tyto/core': patch
---

Add `E_TEMPLATE_CRASH` to the diagnostic catalog: a template that throws something other than a `TemplateError` is a bug in third-party code, and the compile stage turns it into a diagnostic instead of letting it crash the app or the CLI.

ADR 0014 records the decision the code was already assuming — `color()` throws rather than returning a `Result`, and `compile` is the single `catch` where that stops.
