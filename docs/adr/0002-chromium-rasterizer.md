# 0002 — Rasterization through Chromium behind a port

Status: accepted · 2026-09-05 · amended by ADR 0027, which changed how the desktop captures

## Context

Output needs advanced HTML/CSS (blend, masks, filters, web fonts) with alpha. Custom engines (resvg/Skia) do not render HTML.

## Decision

`Rasterizer` port; chromium adapter (offscreen BrowserWindow on desktop, Playwright on CLI/cloud).

## Amended by ADR 0027

The desktop's half of the decision above named a mechanism that does not do what it says, since
2026-09-18: `webContents.capturePage` returns the window's composited surface, and that surface is
clipped to the primary display's work area — 1080×1920 asked, 1080×1680 back on a `workArea` of
3072×1680, with the bottom third silently missing. The desktop now captures through
`webContents.debugger` (`Emulation.setDeviceMetricsOverride` + `Page.captureScreenshot`), on a
window that no longer has to be offscreen.

Everything else here stands, and the amendment is deliberately narrow: Chromium is still the
engine, `Rasterizer` is still the port, the CLI and the cloud still use Playwright, and swapping a
backend is still local to an adapter — which is what made this amendment cheap.

## Consequences

Full CSS fidelity. Swapping or adding a backend is local to the adapter. Vector output does not come from Chromium — it comes from the IR (ADR 0003).
