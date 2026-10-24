---
'@tyto/core': minor
'@tyto/io': minor
'@tyto/desktop': minor
---

TYTO-270: a workspace's `.tyto/project.json`, or the work profile it names, can declare export presets (ADR 0126): `"exportPresets": { "entregas": { "formats": ["grid-1x1", "story"], "folder": "entregas" } }`, with `types` defaulting to `png` and `folder` to the project's `output`. Presets merge by name, profile then folder; a preset's `folder` resolves against the open workspace folder whichever sheet wrote it, and a restricted folder confines it there (`W_PROJECT_PATH_OUTSIDE`, the preset is dropped). A preset with no folder and no `output` is `W_PROJECT_PRESET_NO_FOLDER`. `core` resolves them into `ResolvedProject.exportPresets`; `@tyto/io` reads nested ranges and follows a preset's folder through `realpath`. The window lists each preset in the command bar as "Export: <name>" (`export.preset:<name>`, bindable in `keybindings.json`) and runs it through the export box, which opens already running and removes what the previous export left as before.
