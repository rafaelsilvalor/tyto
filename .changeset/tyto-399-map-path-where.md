---
'@tyto/recipe': minor
'@tyto/plugin-api': patch
---

TYTO-399 (ADR 0136): two generic recipe verbs and numeric comparison in `where`. `map <column> using=<table> [reverse] [also=<table>] into=<column>` translates a column by an object of text to text, compared without accents, case or surrounding blanks and written as the table spells it; `reverse` reads it from value to key (the first key in file order wins on a shared value), `also=` is consulted after it, and a value neither names maps to an empty cell. `path from=<column> to=<column> graph=<graph> avoid=<nodes> into=<column>` writes, as a list, the shortest walk through a graph of each node's arrows: empty when the row is already there, an empty cell when the graph does not join the two without an avoided node; a graph whose names fold to one is refused. The `where` grammar, and so `rules`, `join` and `nearest`, gains `<`, `<=`, `>` and `>=` against a number; a cell that is not a number drops the row.
