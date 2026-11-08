---
'@tyto/recipe': minor
'@tyto/desktop': minor
---

The recipe notebook draws `show board by=<column>` as a Board (TYTO-381, ADR 0177): one column per
value of the column, grouped without case or accents, with the count main made over the rows the
quick filter keeps, and a card per row showing `fields=` (the first three other columns when
absent). `order=` places values first, the rest follow by first appearance and an empty value is
a "(none)" column at the end. A column draws fifty cards, then "N more". View only. A new
channel, `recipe:facets`, counts a column's groups in main, and `recipe:rows` gains `facet` to
page one group's rows. In `@tyto/recipe`, a view's `values` argument reads a data file's list of
strings (`order=@./board.json#/order`) through the host's data resolver, so `show` reads its
arguments asynchronously.
