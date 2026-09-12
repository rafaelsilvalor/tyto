# @tyto/templates

## 0.1.0

### Minor Changes

- c131134: The first two built-in templates: `promo-curso` and `carrossel-lista`.

  Manifest-plus-markup folders under `templates/`, the same shape a designer writes by hand
  and the same one `tyto template check` validates. Both render in feed and story, draw the
  repository's bundled Source Sans 3 rather than carrying their own copy, and come with an
  example brief that is checked on every run.

  The folders are in the package's `files` now, so they publish with it. **Registering them
  as a `template-pack` is still open**: locating a published package's directory at runtime
  and merging a built-in pack with `--templates <dir>` is a decision across three packages
  and wants an ADR. Until then they are used as a folder, which is what they are.
