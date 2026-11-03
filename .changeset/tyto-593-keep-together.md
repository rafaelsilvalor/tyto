---
'@tyto/template-kit': minor
---

TYTO-593: `keepTogether` and `keepTogetherText` join a currency sign and its amount, an amount and its scale word, and a number and its percent with a no-break space before layout, so a line never ends on `R$` with the amount on the next. The rules are data (`KEEP_TOGETHER_RULES`, regular-expression sources) a template extends; a template opts in by calling it.
