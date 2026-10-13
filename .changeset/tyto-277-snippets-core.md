---
'@tyto/core': minor
---

TYTO-277: five diagnostic codes for the person's snippets file (ADR 0082). `E_SNIPPETS_SYNTAX` when the file is not JSON with comments or not a map of snippets, which keeps the last file that read; `W_SNIPPET_INVALID` for an entry not shaped like `{ prefix, body, description?, template? }`; `W_SNIPPET_UNSUPPORTED_BODY` for a body using VS Code syntax Tyto does not translate (variables, transforms, nested fields); `W_SNIPPET_CHOICE_FLATTENED` when a choice field is inserted as its first option; and `W_SNIPPET_UNKNOWN_TEMPLATE` for a snippet limited to a template that is not installed.
