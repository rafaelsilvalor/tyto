---
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/plugin-api': patch
---

TYTO-396 (ADR 0136): three generic recipe verbs that carry a company's rules as configuration. `rules into=<columns> using=<table>` classifies each row by an ordered table of `{ when, set }` entries, where `when` is a `where` expression (`matches` included), the first entry a row satisfies decides, and an empty `when` is the default; the table is a data reference or JSON written inline at the end of the line. `compose <column>="<template>" [skip-empty] [required]` fills a text column from `{column|filter}` placeholders with the filters `slug`, `trim`, `upper` and `lower`. `collect <column> from=a,b,c [skip-empty]` gathers columns into a list column, the keys a row offers `join`. `@tyto/recipe` exports `parseTemplate`, `bindTemplate` and `TEMPLATE_FILTERS`; `@tyto/core` gains `E_RECIPE_RULES` and `E_RECIPE_TEMPLATE`.
