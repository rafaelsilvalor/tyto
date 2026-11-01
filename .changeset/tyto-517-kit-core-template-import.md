---
'@tyto/core': patch
'@tyto/template-kit': patch
---

`@tyto/template-kit` takes `ORPHAN_WORD_LIMIT` from `@tyto/core/template`, which now exports it, instead of the `@tyto/core` root (TYTO-517). Since 0.7.0 a template that bundled the kit inlined the core root's font reader and YAML parser, and came out about three times its size.
