---
'@tyto/desktop': minor
---

Every pane now has the same row of tabs on top — the editor groups, the previews, Problems, the
queue and a plugin's panel alike — so their edges line up across the window, and an editor has a
quiet row under its tabs, as VS Code's breadcrumbs are, where the location will go. The BRIEF bar
and the template picker over the editor are gone: a template is chosen with "New brief from
template…", the "/" menu or the `template:` line. "Open preview to the side" is at the right end
of the tabs. A tab's name is quieter, and a panel's name reads like a file's, "Problems" rather
than "PROBLEMS".

The icons are drawn thinner, and how thin is a setting: `iconStrokeWidth` in `settings.json`,
from 0.75 to 2, 1.25 unless it says otherwise. A save applies it at once.
