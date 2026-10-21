# 0116 — A file's icon comes from its name, its kind and a place main flags

Status: accepted · 2026-10-21 · TYTO-282 · under ADR 0010, ADR 0077, ADR 0112 and ADR 0115

## Context

Rafael asked on 2026-10-12 for an icon on each file in the explorer, as VS Code draws them. The
explorer (ADR 0115) lists entries by id, each with a name and a kind (`folder`, `brief`,
`file`), and the window never holds a path. Some of what the card wants to tell apart can't be
read off a name: the output folder can be called anything, a template folder is a template
folder because of the folder it sits in, and `project.json` is the project file only at
`.tyto/project.json`. ADR 0077 left icon themes out of the theme contribution, and the card asks
whether plugins may contribute file icons.

## Decision

1. **The mapping is a pure function in `shared/file-icons.ts`: `fileIconFor({ name, kind,
place?, expanded? })`.** It never sees a path. It works in this order: main's place, then a
   folder (an `assets` folder by name, otherwise a plain folder that turns open and closed), then
   a brief by its kind, then a whole file name (`template.html`, `template.ts`,
   `manifest.yaml`/`.yml`, `settings.json`, `keybindings.json`, `snippets.json`), then an
   extension (images `.png .jpg .jpeg .svg .webp .gif`, fonts `.ttf .otf .woff .woff2`, `.json`
   and `.jsonc`, `.md` and `.txt`). Anything else gets the fallback page. Names are compared
   case-insensitively, and a leading dot is not an extension.
2. **What a name cannot tell, main flags as a `place` on the listed entry**, computed from the
   **resolved** project the workspace read (ADR 0112): `output` for the folder `output`
   resolves to, `templates` and `assets` for a folder listed under those keys, `template` for a
   folder directly inside a templates folder, and `project` for `.tyto/project.json` at the
   root. Entries are compared by real path. A key a restricted folder refused (ADR 0111) is not
   in the resolved project, so it flags nothing. Nor does a place that does not exist. No folder
   is read to find out what it is: ADR 0115's "a folder nobody expanded is never read" holds.
3. **One place per entry, in a fixed order: output, templates, template, assets.** An output
   folder the project also lists under `assets` is the output folder. A folder that is a
   templates folder and also sits directly inside another one is a templates folder.
4. **When the same folder is read again with different places** (a trust grant can accept a key
   it refused before), the ids and the watcher are kept and the window is told to list again.
5. **The icons are drawn in the status bar's language** (ADR 0076, TYTO-96): a 16 grid,
   `currentColor` only, no width written. The stroke is the `iconStrokeWidth` setting, default
   **1.25** (TYTO-288). The card's "1.5 stroke" predates that setting and is stale. Rafael
   approved the sheet on 2026-10-21, and that approval covers TYTO-302's `folder`. Special
   folders keep their one glyph when open, because the chevron already says open. Only a plain
   folder swaps between closed and open. A templates folder and a template folder share one
   icon. **The brief's icon is pending**: he asked for a shape of its own that cannot be mistaken
   for a text file at 16 px. Until he picks one, a brief is drawn as the fallback page.
6. **Tabs reuse the icons, by document and not by name.** A document is a brief (saved,
   untitled, or a queue task's) or the app's own settings, keybindings or snippets file, so its
   kind is enough. A preview tab keeps the preview icon. The recent list in Ctrl+K gets no icons
   for now: every entry in it is a brief, so an icon would add nothing.
7. **No `fileIcons` plugin contribution point now.** No plugin asks for one, and ADR 0077's
   reason for leaving icon themes out still holds. If one is wanted, its own ADR adds it, and the
   pure mapping is where an override table would go.

## Consequences

- `explorer:list` entries gain an optional `place`. The schema is the window's only source for
  it, and it carries no path.
- The workspace service now hands the explorer the resolved places with the folder
  (`onFolder(folder, places)`).
- Adding a file type means adding a row to the table and an icon to `icons.ts`, and the icon
  waits for a sheet Rafael approves, as every icon does.
