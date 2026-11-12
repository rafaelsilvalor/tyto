---
'@tyto/recipe': minor
'@tyto/desktop': minor
---

The recipe step forms show each verb's summary and each field's help in the window's language
(TYTO-685). `@tyto/recipe` adds `formTexts`, `summaryKey` and `helpKey`: every generic form's
sentence keyed by the verb's and the field's names, the English the source; the desktop
translates them into Portuguese and keeps the English for any sentence it has no translation of.
