---
'@tyto/template-kit': minor
---

Add `@tyto/template-kit/testing`: `compileTemplate` compiles a brief against one code template through the real brief parser, `resolve`, `compile` and the HTML exporter, and answers the scene and one HTML document per frame, so a template's own repository keeps its fixture + snapshot tests without a Tyto checkout (ADR 0152). The kit now depends on `@tyto/brief-lang` and `@tyto/export-html`, which are published with the contract.
