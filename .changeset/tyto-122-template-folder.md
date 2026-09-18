---
'@tyto/desktop': minor
---

TYTO-122 — point the app at a folder of your own templates.

The CLI needed no flag for this: a `templates/` folder beside a brief has been searched before
the built-in pack since ADR 0020. The window had no such door — it was hard-wired to the two
templates the app ships, so anybody with a template of their own had to leave the app and use
a terminal.

Now there is a setting. Choose a folder, and it is searched **first**: your `promo-curso`
shadows the built-in one, and the built-in ones you did not name are still there. The picker,
the preview and the export all see it — all three, with nothing rebuilt — and clearing the
choice goes back to the built-in pack with no restart. It survives a restart too, in
`settings.json` beside `layout.json`. The footer says which folder is in force.

A folder that turns out to hold no templates is reported in the problems panel and does not
take the built-in pack down with it. The folder's own `formats.yaml` replaces the built-in
one when it has one, and falls back when it does not — so a folder that is only templates
does not have to carry a formats file to work.

What it does not do: it does not install a template from a published package, and it does not
notice somebody editing that folder while the app is open.
