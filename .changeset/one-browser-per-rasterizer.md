---
'@tyto/raster': minor
---

The Playwright rasterizer launches one browser, however many rasters arrive together
(TYTO-88).

`browser()` did `await launching` before checking and assigning. That `await` yields the
microtask queue even when there is nothing to await, so two concurrent callers both resumed
with `undefined`, both fell through the guard and both launched. The second assignment won;
`close()` shut that one down and the first stayed alive with its pipes open. A
`tyto render --types png` of any brief with two frames wrote every artifact correctly and
then never exited.

Minor rather than patch because the adapter's options gained `browserType`: the browser type
to drive instead of importing Playwright's `chromium`. It is what lets `browser-reuse.test.ts`
count launches without a browser on disk — through a real Chromium the count is observable
only as a process that hangs, which is why nothing caught this.
