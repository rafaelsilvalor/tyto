---
'@tyto/desktop': minor
---

The recipe notebook draws `show cards [fields=<columns>]` as loose cards (TYTO-384, ADR 0177 note
of 2026-11-08): a grid of cards of one size showing `fields=` (the first four columns when
absent), 48 at a time under the quick filter. Opening a card, by click or Enter, shows every
column of its row, those the card leaves out included, with its provenance (source, id, fetched
at) and its link, the first `link` column holding a web address. Escape closes it. View only.
Main answers the row on a new channel, `recipe:row`, values cut at 10,000 characters.
