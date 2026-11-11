---
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/core': patch
'@tyto/desktop': minor
'@tyto/command-line': minor
---

A plugin can have the host send a credential in a header, `host.fetch(url, { credentialHeaders })`,
without ever holding it, only to a host a `net:` permission of its own names (`E_CREDENTIAL_HOST`
otherwise). `host.storage` keeps small durable JSON records under the plugin's data folder,
kept by updates and a wiped cache and removed with the plugin (`E_PLUGIN_STORAGE`). ADR 0191; the
isolation protocol is 24.
