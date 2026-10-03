---
'@tyto/templates': minor
---

TYTO-210: a new template, `banner-roxo`, and three new formats in the built-in pack: `banner` (1200 × 628), `banner-1x1` (600 × 600) and `banner-345x146` (345 × 146), all of kind `banner`. The template draws Roxo's product banner: write only `::titulo`, for example `Prefeitura Municipal de São Bento do Altavale **(GO)**`, and each format draws its own fixed background from the template's folder with the text centred where the reference draws it. The template chooses the line breaks: the largest size that fits, balanced lines, a group in parentheses never split or alone on a line, and no line ending on `de`, `do` or `e` when a better break exists. A text too long for the smallest size is drawn at that size and reported as `W_TEMPLATE_OVERFLOW`. `tabela-roxo` now also keeps a multi-word qualifier in parentheses whole after a number.
