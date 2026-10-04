---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/pipeline': minor
'@tyto/template-kit': patch
'@tyto/template-lang': patch
'@tyto/templates': patch
---

TYTO-223: a plugin contributes a brand kit — a logo mark and a signature per brand id — through
the new `brand-kit` extension point, and a template reads the kit of its own manifest's `brand`
from `context.brand` (ADR 0063). `TemplateContext` gains the required `brand` field; a context
built by hand passes `noBrandKit`. `CompileOptions` and `JobPorts` take `brandKits`, which
`PluginRegistry.brandKitsByBrand()` merges: the plugin registered first keeps a brand, and
`W_BRAND_KIT_SHADOWED` names the one it hid. The kit is data and crosses to an installed code
template with the call, so the isolation protocol is now version 3. `Mark` moves to
`@tyto/core` as `MarkShape`; `@tyto/template-kit` still exports it as `Mark`.
