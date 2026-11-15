---
'@tyto/command-line': minor
---

`tyto mcp`'s `list_templates` lists template aliases, as `tyto template list` does: an alias is a
row with `aliasOf` naming the template it reaches, every row says its `origin`, and `formats` is
what a render accepts under that name, narrowed by a configuration that restricts them.
