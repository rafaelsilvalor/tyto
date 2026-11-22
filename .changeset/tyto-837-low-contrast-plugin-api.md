---
'@tyto/plugin-api': minor
---

TYTO-837: a template running in its plugin's process may send back `W_TEMPLATE_LOW_CONTRAST`
(two hex colours, a ratio from 1 to 21); anything else in it is refused as `E_PLUGIN_PROTOCOL`.
The RPC protocol is 31.
