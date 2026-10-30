---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/desktop': patch
---

A plugin file's configuration may restrict its formats with `formats:` beside `brand:` (TYTO-475, ADR 0155 decision 6). A brief, a run's `--formats` or the Export dialog asking that configuration for another format gets `E_UNKNOWN_FORMAT` under the name the brief wrote, with a hint naming the configuration; a configuration without one takes its entry `default`'s. A format the template does not render, a list with nothing left, or a `brief.formats` default outside the restriction is the new `W_CONFIGURATION_FORMATS_INVALID`. The desktop's template list offers a restricted configuration only its formats.
