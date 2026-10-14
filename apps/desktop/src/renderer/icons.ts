import { type SVGTemplateResult, html, svg } from 'lit';

/**
 * The status bar's nine icons, drawn for Tyto (TYTO-248, ADR 0076), and two for the panes.
 *
 * **The nine are copied from the sheet Rafael approved on 2026-10-08 (TYTO-96, comment 1291169)
 * and not redesigned.** Geometry on a 16 grid; no icon carries a colour of its own, so each one
 * is whatever `color` the button around it has, which is a token.
 *
 * **The stroke is a setting** (TYTO-288): `iconStrokeWidth` in `settings.json`, default 1.25
 * since Rafael chose it over the sheet's 1.5 by looking at both. No icon writes a width: the
 * sheet's `.icon` reads `--tyto-icon-stroke`, which `tokens.css` defaults and the theme sheet
 * sets from the setting (`theme.ts`). The two dots (`.icon__dot`) are 0.4 of the stroke, the
 * ratio they had at 1.5, so they stay in proportion at any width.
 *
 * `preview` and `lock` are **not on that sheet**. TYTO-287 drew them provisionally; TYTO-288
 * redrew both in the nine's manner — the same frame, the same stroke, the problems icon's dot —
 * and put them on a sheet beside the nine for Rafael's approval, which is still pending.
 */

export type IconName =
  | 'left'
  | 'right'
  | 'bottom'
  | 'commandBar'
  | 'problems'
  | 'queue'
  | 'plugins'
  | 'export'
  | 'settings'
  // TYTO-287: "Open preview to the side" in a group's header row, and a locked preview.
  | 'preview'
  | 'lock';

const FRAME = svg`<rect x="2" y="2.75" width="12" height="10.5" rx="2" />`;

/** The fill an area icon gets while its area is on screen. */
const on = (x: number, y: number, width: number, height: number): SVGTemplateResult =>
  svg`<rect x=${x} y=${y} width=${width} height=${height} rx="1" fill="currentColor" stroke="none" opacity=".45" />`;

const GEOMETRY: Readonly<Record<IconName, (lit: boolean) => SVGTemplateResult>> = {
  left: (lit) => svg`${FRAME}<path d="M6 2.75v10.5" />${lit ? on(2.75, 3.5, 2.5, 9) : ''}`,
  right: (lit) => svg`${FRAME}<path d="M10 2.75v10.5" />${lit ? on(10.75, 3.5, 2.5, 9) : ''}`,
  bottom: (lit) => svg`${FRAME}<path d="M2 9.25h12" />${lit ? on(2.75, 10, 10.5, 2.5) : ''}`,
  commandBar: () => svg`${FRAME}<path d="M5 6.25 6.75 8 5 9.75M8.5 9.75h2.5" />`,
  problems: () =>
    svg`<path d="M8 2.5 14 13H2Z" /><path d="M8 6.5V9" /><circle class="icon__dot" cx="8" cy="11" r=".5" fill="currentColor" stroke="none" />`,
  queue: () =>
    svg`<path d="M2.75 4h10.5M2.75 7.5h10.5M2.75 11h5" /><path d="M10.5 9.5 14 11.5 10.5 13.5Z" />`,
  plugins: () =>
    svg`<rect x="2.5" y="2.5" width="5" height="5" rx="1" /><rect x="2.5" y="8.5" width="5" height="5" rx="1" /><rect x="8.5" y="8.5" width="5" height="5" rx="1" /><path d="M11 2.2 13.8 5 11 7.8 8.2 5Z" />`,
  export: () =>
    svg`<path d="M2.75 9.5v2.25a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V9.5M8 10V2.75M5 5.5 8 2.5l3 3" />`,
  settings: () =>
    svg`<path d="M2.75 4.5h3M9 4.5h4.25M2.75 11.5h6M12 11.5h1.25" /><circle cx="7.5" cy="4.5" r="1.5" /><circle cx="10.5" cy="11.5" r="1.5" />`,
  // The frame split down the middle: lines of text on the left, a picture's peak on the right.
  preview: () =>
    svg`${FRAME}<path d="M8 2.75v10.5M4.25 6.25h1.5M4.25 9h1.5M9.75 10.25 11 8.5l1.25 1.75" />`,
  // A padlock on the frame's corner radius, with the problems icon's dot for the keyhole.
  lock: () =>
    svg`<rect x="3" y="7.25" width="10" height="6.25" rx="2" /><path d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75" /><circle class="icon__dot" cx="8" cy="10.35" r=".5" fill="currentColor" stroke="none" />`,
};

/** One icon, decorative: the button it sits in carries the words (`aria-label`). */
export const icon = (name: IconName, lit = false): unknown =>
  html`<svg
    class="icon"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    ${GEOMETRY[name](lit)}
  </svg>`;
