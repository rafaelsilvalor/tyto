---
'@tyto/desktop': minor
---

TYTO-385: while the window is open, main runs every recipe in a trusted workspace folder whose
header says `every`, from the file on disk, one interval after it is found and then one interval
after each run starts. A run still going skips the next tick; after sleep a missed recipe runs
once. A restricted folder runs nothing, a recipe needing a parameter is listed and not run, and
`apply auto` applies there as on Run. The first run with a problem after a clean one raises one
OS notification naming the recipe and the code. Three new channels and one event carry the list,
Run now and Open by main's ids; the panel that shows them comes next.
