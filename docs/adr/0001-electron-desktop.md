# 0001 — Desktop on Electron

Status: accepted · 2026-09-05

## Context

We need a local UI with a rich editor, live preview, fs and keychain access, and a future cloud version.

## Decision

Electron with electron-vite. Renderer without Node; typed preload; contextIsolation.

## Consequences

The bundled Chromium doubles as the rasterizer. ~200 MB app. Tauri rejected: requires Rust and does not ship a consistent Chromium across OSes.
