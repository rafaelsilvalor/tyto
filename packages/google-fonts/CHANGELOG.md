# @tyto/google-fonts

## 0.1.0

### Minor Changes

- ae75027: TYTO-281: a template's font this machine lacks is fetched from Google Fonts on first use (ADR 0120). `@tyto/google-fonts` is a new built-in `font-source`, pure, that reaches Google only through `host.fetch` and knows which families Google serves from a bundled snapshot; the face is cached in `TYTO_HOME` and every later render reads it. A missing family nobody can supply — CircularXX — is never fetched and gets one line, the new `W_FONT_UNAVAILABLE` in `@tyto/core`, naming the substitute and the free alternatives the template's manifest lists under the new `fonts` key. `tyto render` and `tyto watch` turn it off with `--no-google-fonts` or `TYTO_GOOGLE_FONTS=off`, and then a missing face is `W_FONT_SUBSTITUTED` exactly as before.

### Patch Changes

- Updated dependencies [d4a6939]
- Updated dependencies [08b936d]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [15997e9]
- Updated dependencies [93fcb8b]
- Updated dependencies [c005b91]
- Updated dependencies [cbbf6df]
- Updated dependencies [2495d0d]
- Updated dependencies [6abf89f]
- Updated dependencies [53e01c3]
- Updated dependencies [ae75027]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
- Updated dependencies [bf3fd0e]
- Updated dependencies [8e9c9c4]
- Updated dependencies [ab9512e]
- Updated dependencies [d3df40e]
- Updated dependencies [4aba89c]
  - @tyto/plugin-api@0.5.0
  - @tyto/core@0.29.0
