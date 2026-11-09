---
'@tyto/command-line': minor
'@tyto/cli': minor
'@tyto/desktop': patch
---

TYTO-565: `tyto mcp [folder]` serves a folder's templates and briefs to an AI agent over the
Model Context Protocol on stdio, with four read tools: `list_templates`, `describe_template`,
`check_brief` and `render_preview` (a PNG at most 1,024 px on its longest side). A restricted
folder is offered no tool that writes (ADR 0179). A plugin's process now prints onto stderr, so
its output no longer lands in `tyto render --json`'s document. The window refuses `tyto mcp`.
