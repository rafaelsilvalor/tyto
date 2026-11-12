---
'@tyto/desktop': minor
---

TYTO-649: a multi-line credential, such as a service account's JSON key, can be stored from the
plugins screen. Each credential line has Import from file…: main opens the picker, reads the
file (16 KiB at most, ADR 0134; empty or non-UTF-8 files are refused, a UTF-8 byte-order mark is
dropped) and stores its exact text in the keychain. The new `credentials:import` and
`recipe-credential:import` channels name the credential and answer an outcome, never the path or
the text. The credential fields, a plugin's and a recipe's, are now masked textareas that keep
line breaks (Ctrl+Enter saves), open empty and never show a stored value.
