# 0039 — A page says it can hear the quit question before it is asked

Status: accepted · 2026-09-27 · TYTO-44 · amends ADR 0031

## Context

ADR 0031 gave the quit question two stages: the window acknowledges on `app:exit-ack` the instant
`app:exit-requested` reaches it, and a 30 s deadline bounds that acknowledgement. When the deadline
runs out the question is dropped and **the app stays**. The deadline was written for "a push
reaching a listener that is already registered", and nothing made that premise true.

`ipcRenderer` drops a message sent to a channel nobody is subscribed to, without a trace. The
listener was registered in `load()` after three awaits (`app:info`, `layout:get`, `applyLayout`),
so a quit that arrived while the page was still starting pushed into a page with no listener: no
acknowledgement, the question dropped at 30 s, and the app open for good with nobody left to ask
again. PR rafaelsilvalor/tyto-archive#223 (TYTO-44) did not introduce the race. It moved the page's timing enough for
`packaged.package.test.ts`, which quits the app a few hundred milliseconds after launch, to land
in it every time on CI. The packaged step hung its 600 s `afterAll`, and rafaelsilvalor/tyto-archive#225 reverted the card.

Measured on CI (run 36327839636) with temporary `[quit-probe]` lines on every step of the quit.
The packaged app, quit by `closeApp` (main's clock starts at main's module load; the renderer's
number is its own `performance.now()`):

```
[quit-probe] test: closeApp start
[quit-probe] +303ms before-quit handles=[] requests=[] metrics=[Browser:6468,GPU:6492,Utility:6498,Tab:6529] windows=alive
[quit-probe] +309ms push sent askId=0 url=sources/app.asar/out/renderer/index.html loading=true
[quit-probe] +309ms mayExit -> false
[quit-probe] renderer listener registered at 251ms
[quit-probe] +5315ms tick handles=[Socketx1] requests=[] metrics=[Browser:6468,GPU:6492,Utility:6498,Tab:6529] windows=alive
…the same line every 5 s…
[quit-probe] +90399ms tick handles=[Socketx1] requests=[] metrics=[Browser:6468,GPU:6492,Utility:6498,Tab:6529] windows=alive
```

No `ack received`, no `push received` in the renderer, no `answering`, no `will-quit`, no dialog
called, and no handle or process beyond Playwright's socket. The control, the unpackaged app in
the same run with its page already loaded:

```
[quit-probe] +594ms push sent askId=0 url=yto/apps/desktop/out/renderer/index.html loading=false
[quit-probe] +594ms mayExit -> false
[quit-probe] +595ms ack received askId=0
[quit-probe] +596ms answer received askId=0 allow=true
```

This is a product defect and not only a test's. A person who presses Cmd+Q or the X while the
window is starting gets a quit that does nothing.

## Decision

1. **A new request, `app:exit-listening`**, sent by the page right after it subscribes to
   `app:exit-requested` (`listenForExit` in `src/renderer/exit.ts`). That subscription is the
   first thing `load()` does, before anything is awaited.
2. **Until main has it, `mayExit` treats the window as having nobody to ask**: it sends nothing,
   latches, and lets the exit through, the same answer `quit.ts` already gave when `send` found no
   live `webContents`.
3. **`windowGone` takes it back.** The three events wired to it (`render-process-gone`, the
   window's `closed` and a main-frame navigation) each leave a page that has not registered yet.
   A reload is the one that matters: without the reset, main would believe the new page could hear
   a push it would in fact drop, and the hang would come back through DevTools' reload.

**Why letting the quit through is safe.** The question protects unsaved text, and unsaved text
lives in a workspace that `load()` builds. The listener is registered before any of that: before
the editor mounts, before a file can be opened, before a key can reach a buffer. The only document
at that moment is the untitled one the module starts with, which is clean by ADR 0026's
comparison. `src/renderer/exit.test.ts` asserts that workspace counts as nothing to lose.

The 30 s deadline stays as ADR 0031 wrote it, and its premise is now true by construction: main
pushes only into a page that has said it is listening.

## Consequences

- `e2e/quit.desktop.test.ts` builds the gap instead of racing it. The window is navigated to
  `about:blank`, a page that never registers, and the quit goes through within 10 s. With the gate
  removed, or with the reset in `windowGone` removed, that case goes red (`expected 'still running'
to be 'gone'`). A second case reloads, dirties a tab and quits: the box is still asked, so the
  new page did say it was listening.
- `packaged.package.test.ts` is unchanged. It still waits for the bridge rather than the renderer
  (TYTO-175), and it now passes because the app quits correctly in the state it catches it in.
- A quit during startup no longer asks anything. This is correct only while the listener stays
  first in `load()`. Moving anything that can hold text in front of it would reopen the loss this
  question exists to prevent.
