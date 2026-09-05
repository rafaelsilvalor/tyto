# 0002 — Rasterization through Chromium behind a port

Status: accepted · 2026-09-05

## Context
Output needs advanced HTML/CSS (blend, masks, filters, web fonts) with alpha. Custom engines (resvg/Skia) do not render HTML.

## Decision
`Rasterizer` port; chromium adapter (offscreen BrowserWindow on desktop, Playwright on CLI/cloud).

## Consequences
Full CSS fidelity. Swapping or adding a backend is local to the adapter. Vector output does not come from Chromium — it comes from the IR (ADR 0003).
