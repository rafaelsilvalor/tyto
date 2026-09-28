---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/pipeline': minor
'@tyto/fonts': minor
'@tyto/cli': minor
---

TYTO-189: an installed plugin can ship code templates, and they run in its own thread. A folder
in an installed pack with a `manifest.yaml` and no `template.html` is drawn by the pack's new
`build(template, context)`, called through the isolation with the 30 s deadline. The frame is
checked against the IR, and a timeout, throw or refused answer is `E_PLUGIN_TEMPLATE`, which
costs that frame and not the render. `context.measure` still answers synchronously. The manifest
lists the faces it measures under `faces:`, and those cross with the call. A face installed on
the machine crosses only under the `font:<family>` permission (`W_PLUGIN_FONT_WITHHELD` otherwise).
`tyto plugin new --code` scaffolds one that installs and renders on the first try. `compile` is
unchanged for every other template, and `compileDeferred` is the new path (ADR 0048).
