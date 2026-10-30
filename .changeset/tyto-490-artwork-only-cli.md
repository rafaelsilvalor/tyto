---
'@tyto/cli': minor
---

`tyto render --folder` writes only the artwork into `<out>/<brief-name>/`: no `result.json`, no `editaveis/` with the brief and `template.txt`, no `assets/` with the brief's images (TYTO-490, ADR 0157). The run's report is what the command prints, one document under `--json`. A file that an earlier run wrote and this one did not produce is no longer removed, since there is no report to say it was Tyto's. `--out` and `tyto watch` are unchanged.
