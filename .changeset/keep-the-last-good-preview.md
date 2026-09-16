---
'@tyto/desktop': minor
---

TYTO-108 — the artwork stays on screen when the brief stops compiling

Typing a stray character used to blank the preview, at the one moment the preview is the
thing telling you whether the fix worked. Now the artwork stays and says it is older than the
text being written.

**The marker is the feature; keeping the pixels is the easy half.** A preview that silently
showed old art would answer "did my fix work" with yesterday's answer. It reads as a state of
the pane rather than as a second error message — the problems panel already lists what is
wrong — and it sits inside the preview stage so that it is legible with that panel closed,
which is the case this card is about.

**Derived, not stored.** `DocumentState` gains `renderedBrief`, the text the current frames
came from, and `isStale` is `frames.length > 0 && renderedBrief !== brief`. There is no flag
for one code path to set and another to forget: a compile that starts working again clears the
marker on the answer that fixes it. A brief that has never rendered is empty rather than
stale, which is the case a boolean would get wrong on a new tab.

**The discriminator is the errors, not the empty list.** A brief that compiles to nothing is a
legitimate answer and clears the pane; frames are kept only when the compile actually failed.

What it deliberately does not do: render partial output — that is TYTO-107 — keep frames
across a reopen, or change what `brief:preview` sends.
