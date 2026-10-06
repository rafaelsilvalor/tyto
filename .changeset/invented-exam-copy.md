---
'@tyto/templates': patch
---

TYTO-237: the `agenda-semana` and `simulados-semana-ocre` examples carry invented copy of the same shape in their last lines that still quoted real names. Every template draws the same bytes as before for the same brief; only those two examples' renders change.
