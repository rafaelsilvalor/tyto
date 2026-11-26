---
'@tyto/export-html': minor
---

A run's box is drawn (ADR 0231, TYTO-900): a band from the face's metrics in a span around the run, one per line the run breaks across, the same in Electron 44 and Chrome 158. A box without metrics covers the glyph box and reports `W_EXPORT_APPROXIMATED`. Output with no box is unchanged.
