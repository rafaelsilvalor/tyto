---
'@tyto/command-line': minor
---

TYTO-726: `environment.refuse` may answer `{ without: ['trust'] }`, to run the command with
an allow-listed boolean option cleared (`CLEARABLE_OPTIONS`), or `{ handled }`, to print a
sentence and exit 0 without running it. An option outside the list, or one the command does
not declare, is an internal failure. A terminal passes no hook and behaves as before.
