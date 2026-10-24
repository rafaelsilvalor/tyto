# 0129 — A write verb plans first, and applies on confirmation

Status: accepted · 2026-10-24 · TYTO-368 · builds on ADR 0111 and ADR 0128

## Context

The connectors write to systems other people rely on: Jira statuses, assignees, fields,
comments and new issues; Google Sheets rows, tabs and new spreadsheets; Drive folders. A
recipe is shared between people (ADR 0128), and it may run on a schedule (ADR 0127).
Buraqueira learned two rules for this: it may make only the writes its allow-list names
(`adapter_jira_escrita.py`), and it walks a status graph one checked transition at a time,
because Jira has no "go to status X".

## Decision

1. **Running an action or a sink cell writes nothing.** It returns a plan: the target, one line
   per operation, and a count. The notebook shows the plan under the cell, with Apply.
2. **Apply runs the plan that was shown**, not a recomputed one. If the target moved between
   the plan and the apply (an issue's status changed), that operation fails and says so; the
   others still run. What happened is recorded in the cell's result.
3. **A connector declares the kinds of write it may make**, in its manifest, and the host
   refuses any other. The person sees them when the plugin is installed.
4. **A scheduled recipe applies without a click only when** its header says `apply auto` **and**
   the workspace is trusted (ADR 0111). A restricted folder's recipe always stops at the plan.

## Consequences

- A designer can run a colleague's recipe and see exactly what it would change before anything
  changes.
- Applying the shown plan instead of a fresh one means a slow reader can apply something stale.
  The failure is per operation and visible, which is the trade for "what you saw is what ran".
- A plan is also the report: Buraqueira's `sync_report.json` and its text summary become the
  plan and its applied result.
