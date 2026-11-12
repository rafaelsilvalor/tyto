---
'@tyto/recipe': minor
'@tyto/core': minor
---

A recipe can report to a person with `warn when="<where>" message="<template>"`: one `W_RECIPE_WARN` warning per row the expression keeps, in table order, naming the row's key, its message filled from the row with `compose`'s `{column|filter}` templates or read from a data file. The table passes on unchanged, so the warning outlives a later `where` that drops the row. One step lists at most 100 rows and adds one warning counting the rest. `@tyto/core` gains the `W_RECIPE_WARN` code; the `warn` form joins `GENERIC_VERB_FORMS`.
