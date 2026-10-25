---
'@tyto/recipe': minor
'@tyto/plugin-api': patch
---

TYTO-398 (ADR 0136): the generic recipe verb `nearest <prefix> within=<column> among="<where>" by=words(<column>) stopwords=<words> [min-length=<n>] bring=<columns>`. For each row it looks at the other rows of its group that the `among` expression keeps and chooses the only one, or the one sharing the most distinct words of the `by` column (lower case, without the stopwords and words shorter than `min-length`, two by default), the first in table order on a tie and none when no word is shared. What `bring` names is added as `<prefix>_<column>`; nothing is consumed. The stopwords are written inline or read from a data file.
