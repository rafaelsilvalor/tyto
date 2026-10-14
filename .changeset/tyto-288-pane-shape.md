---
'@tyto/desktop': minor
---

Every pane now has the same top: a row of tabs and, under it, a thin row for its actions — the
editor groups, the previews, Problems, the queue and a plugin's panel alike — so their edges line
up across the window. The BRIEF bar over the editor is gone: the template picker sits in the
focused group's row, and "Open preview to the side" moved there from the tabs. A tab's name is
quieter, and a panel's name reads like a file's, "Problems" rather than "PROBLEMS".

The icons are drawn thinner, and how thin is a setting: `iconStrokeWidth` in `settings.json`,
from 0.75 to 2, 1.25 unless it says otherwise. A save applies it at once.
