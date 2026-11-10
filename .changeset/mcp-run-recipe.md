---
'@tyto/command-line': minor
---

`tyto mcp` offers `run_recipe` in a trusted workspace (ADR 0185, note of 2026-11-10): a run answers
each cell's table and plan and changes nothing, `apply auto` included; an apply names the cell and
the plan id that run answered. No answer carries a plan's payload or a plugin's section.
