---
'@tyto/templates': minor
---

TYTO-218: a new template, `tabela-roxo`. It draws roxo's title over a whole table in one 1080 × 1350 image. Write `::titulo`, then `::tabela`: the first line is the header (`Concurso | Banca | Vagas | Salário`) and fixes the column count, each later `a | b | c` line is a row, and a line with no `|` is a band across the table. The template measures to decide column widths, line breaks, the body size and the title size. It never splits a value such as `R$ 33.820,39`, breaks a range `R$ X a R$ Y` between its two values, and reports `W_TEMPLATE_OVERFLOW` when the table does not fit even at its 16 px floor. The accent is roxo's registered `#5900a6`, the agenda's.
