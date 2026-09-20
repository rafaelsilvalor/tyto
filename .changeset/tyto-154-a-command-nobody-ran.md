---
'@tyto/desktop': patch
---

TYTO-154 — the export end-to-end suite went red at random, and the cause was a command the
window silently refused rather than anything about exporting.

**What was happening.** The suite waited for `.shell` before driving the app. `.shell` is in
`index.html`, so it is on the page before a single line of the renderer has run — it was a wait
for nothing. The suite then ran `editor.open` through the command bar, and two gates decline a
command that early: the bar's `run` is a no-op until the window has finished loading, and
`runCommand` answers `false` for as long as the editor is not mounted. Both decline in silence,
which is right for a person clicking a button that cannot work yet and useless for a test. The
open never reached main, the file picker was never opened, and the next line waited thirty
seconds for text that was never coming.

**Measured, on Windows, against the built app.** The editor mounts **32-80 ms** after `.shell`
exists (6 launches). A probe firing the command at `.shell` lost that race in **2 of 6**
launches, and in both of them the editor was not mounted at the instant of the click; the same
probe waiting for the editor won it **6 of 6**. The flake reproduced here on the **second**
consecutive run of the unchanged suite, at the line the card recorded.

**The trigger is machine load, which is why an idle loop is the wrong instrument.** With the old
wait left in place the suite went 8 of 8 green on an idle machine and then red on the **4th** run
with six CPU-burning workers alongside it. The fixed suite under that same load: **6 of 6 green**.
That also explains the card's own asymmetry — 1 red of 2 on a CI runner, 2 of 8 here with both
reds first and back to back.

**The fix is in three parts.**

- The suite waits for `#editor .cm-content` and `.tabs__tab`, which is what the other thirteen
  suites already wait for. That closes the race.
- `CommandBar.run` now answers whether the command actually ran. The registry always knew; the
  answer was thrown away at the call site. The suite's helper checks it and fails immediately
  with _the command bar refused 'editor.open'_ instead of waiting thirty seconds for a
  consequence that cannot happen.
- When the wait does expire, the failure now names the stage: the tab labels, whether the editor
  is mounted, and the first 120 characters of the viewport. A tab named `promo.brief` with an
  empty viewport means main answered and the drawing is the problem; an untitled tab means the
  open never came back from main. `.cm-content` holds the viewport and not the buffer, so the
  tab label is what tells those two apart.

Nothing about a timeout was raised. The 30 s was never the problem, and a bigger number would
have made the red runs slower rather than rarer.

Also here, one line of it: `e2e/close-app.ts` said it answers the quit box's _confirm_ button at
index 1, which was true of the two-button box TYTO-153 replaced. Index 1 is _Não_ now — the same
act, a different name — and the comment says so rather than leaving the next reader to find it.
