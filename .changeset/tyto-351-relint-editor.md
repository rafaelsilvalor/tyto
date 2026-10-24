---
'@tyto/editor': patch
---

TYTO-351: `relintBrief`, a state effect that makes `briefLint` lint the same text again. CodeMirror's linter reruns only on a change of text or configuration, so a host whose analysis learns something new about unchanged text had no way to redraw the underline; dispatching `relintBrief.of(null)` now does it.
