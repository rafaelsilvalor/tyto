---
'@tyto/google-fonts': minor
'@tyto/core': minor
'@tyto/cli': minor
---

TYTO-281: a template's font this machine lacks is fetched from Google Fonts on first use (ADR 0120). `@tyto/google-fonts` is a new built-in `font-source`, pure, that reaches Google only through `host.fetch` and knows which families Google serves from a bundled snapshot; the face is cached in `TYTO_HOME` and every later render reads it. A missing family nobody can supply — CircularXX — is never fetched and gets one line, the new `W_FONT_UNAVAILABLE` in `@tyto/core`, naming the substitute and the free alternatives the template's manifest lists under the new `fonts` key. `tyto render` and `tyto watch` turn it off with `--no-google-fonts` or `TYTO_GOOGLE_FONTS=off`, and then a missing face is `W_FONT_SUBSTITUTED` exactly as before.
