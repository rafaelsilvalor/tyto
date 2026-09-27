---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/pipeline': minor
'@tyto/editor': minor
'@tyto/cli': minor
---

TYTO-49: plugin directives (ADR 0043). A plugin registers a `directive` contribution whose `id`
is its namespace, with the `names` it answers and a `transform` that turns `::ns/name` into
ordinary slot directives, which `resolve` checks against the manifest as if they were typed. The
directive's adjustments are the plugin's arguments, handed over parsed and ranged, and the host
stamps every range in the answer. `ResolveOptions.directives` and `JobPorts.directives` take the
host's point through `directiveResolverOf`. The CLI wires it into every render, and an installed
plugin's transform runs in its worker under the per-call deadline. The editor offers `ns/name`
after `::`. Without the plugin the brief still gives `E_UNKNOWN_DIRECTIVE` on the name, and a
plugin's refusal of its arguments is the new `E_DIRECTIVE_ARGUMENT`.
