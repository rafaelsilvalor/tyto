---
'@tyto/desktop': minor
'@tyto/core': minor
---

TYTO-151 — a new version of the desktop app offers, once, to bring the templates folder, the
panel layout and the recent files across from the highest older version on the machine (ADR
0036). The older version's folder is copied, never moved; declining is recorded in the new
folder and not asked again. Saved sign-ins travel only when the person ticks a separate,
unticked box. Anything the older folder could not give is a new `W_IMPORT_SKIPPED` warning in
the log, and never stops the app from opening.
