---
'@tyto/brief-lang': patch
'@tyto/core': patch
'@tyto/editor': patch
'@tyto/fonts': patch
'@tyto/house-style': patch
'@tyto/plugin-api': patch
'@tyto/template-kit': patch
---

Tests and comments stop naming the production templates as if they were built in (TYTO-436): a test's template name is invented or one of the pack's test templates, and a comment about a template in its own repository names the repository. No behaviour changes.
