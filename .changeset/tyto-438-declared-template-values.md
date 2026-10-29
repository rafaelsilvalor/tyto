---
'@tyto/core': minor
'@tyto/template-kit': minor
'@tyto/house-style': minor
'@tyto/templates': patch
---

TYTO-438: a template's manifest may declare what a configuration can change in it, under `values` — each a `color`, `length`, `number`, `face` or `image`, with its default and, for a length or a number, its limits (ADR 0153). `compile` hands the template the resolved values as `context.values`, the defaults overlaid by `CompileOptions.values`, and a supplied value the template did not declare, of the wrong kind or outside its limits is a warning at its range (`W_TEMPLATE_VALUE_UNKNOWN`, `W_TEMPLATE_VALUE_INVALID`) while the default stands. A template reads them with `numberValue`, `colorValue`, `faceValue` and `imageValue` from `@tyto/core/template`. `compileTemplate` in `@tyto/template-kit/testing` takes `values`. The house's one-image table reads its title gap, title and body size limits, optical drop and colours this way (`TABLE_VALUE_DEFAULTS`), and the built-in `tabela-roxo` declares them, drawing the same bytes when nothing is configured. Nothing reads a plugin file's configuration yet (TYTO-439), and values do not cross to a template in a plugin's process yet.
