---
'@tyto/core': minor
'@tyto/cli': minor
---

TYTO-50: an installed template pack now reaches a render. `tyto render` and `tyto watch` search
the templates an installed plugin registers, after the project's and the built-in pack's, and a
name an earlier source holds is reported as `W_TEMPLATE_SHADOWED`. A pack's `directory` must be
relative to the plugin's installed folder and stay inside it (`E_PLUGIN_PACK_DIRECTORY`), and every
template in it must be markup (`E_PLUGIN_PACK_CODE`). Either refusal skips the whole plugin
(ADR 0046). `tyto plugin new <name>` scaffolds a template pack that installs and renders
unedited, and `docs/plugin-authoring.md` walks one from scaffold to render.
