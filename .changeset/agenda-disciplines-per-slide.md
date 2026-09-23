---
'@tyto/templates': minor
'@tyto/cli': minor
---

TYTO-173: `agenda-semana` puts several disciplines on one slide, as the published carousel does.

**Breaking for a brief written against 1.0.0 of the template.** The repeatable slot is now `slide`,
not `disciplina`: one occurrence is one slide, and inside it a line with no `|` starts a discipline
and every `date | title | professor` line under it is one of its sessions. The template renders in
a new `retrato` format (1080×1350, Instagram's 4:5 post), added to the pack's `formats.yaml`; it
no longer declares `feed` or `story`.

The slide is three bands: the owl pinned to the top, the handle and arrow to the bottom, the cover
under the owl on the first slide only, and the disciplines centred in what is left. The date pill
sits on the left end of the grey pill instead of beside it, sessions are 4 px apart, and a title
too long for its pill is drawn smaller (`overflow: 'shrink'`) instead of reported. The owl and the
arrow are the brand files' geometry, with the colour still the template's.

**`tyto render` now measures text.** The CLI hands `compile` the bundled faces, as the desktop
preview already did. Before this, a `shrink` reached `export-html` as `W_EXPORT_APPROXIMATED`
and was clipped, line breaks were left to the exporter, and `W_TEXT_OVERFLOW` was never raised.
