import { type SVGTemplateResult, html, svg } from 'lit';

import type { FileIconName } from '../../shared/file-icons.js';

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
 * `folder` (TYTO-302) is drawn the same way and waits on the same kind of sheet.
 *
 * `explorer` and the two chevrons are **on a sheet Rafael approved on 2026-10-21** (TYTO-279):
 * the tree he chose for the explorer's button, on the frame icons' 2.75–13.25 band so its
 * foot sits where theirs does, and the tree rows' chevron, drawn once and turned.
 *
 * **The file icons are on a sheet Rafael approved on 2026-10-21** (TYTO-282, ADR 0116), which
 * also approved `folder` as TYTO-302 drew it. The brief's own icon is not: he asked for a shape
 * that cannot be mistaken for a text file at 16 px, and until he picks one a brief is drawn as
 * the fallback page. Which file gets which icon is `shared/file-icons.ts`.
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
  | 'lock'
  // TYTO-302: "Choose folder…" in the queue's tool header.
  | 'folder'
  // TYTO-279: the explorer's status-bar button, and a folder row closed and open.
  | 'explorer'
  | 'chevronRight'
  | 'chevronDown'
  // TYTO-282: a file or folder in the explorer and on a tab.
  | FileIconName;

const FRAME = svg`<rect x="2" y="2.75" width="12" height="10.5" rx="2" />`;

/** A page on the frame icons' band, folded at the top right: every page-shaped file icon. */
const PAGE = svg`<path d="M4.75 2.75h4L12 6v6a1.25 1.25 0 0 1-1.25 1.25h-6A1.25 1.25 0 0 1 3.5 12V4a1.25 1.25 0 0 1 1.25-1.25Z" /><path d="M8.75 2.75V6H12" />`;

/** The folder as TYTO-302 drew it, without its flap line, for the folders that add a glyph. */
const FOLDER = svg`<path d="M2 5a2 2 0 0 1 2-2h2.25l1.5 1.75H12a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />`;

const BRACES = svg`<path d="M6 3.25H5.5A1.25 1.25 0 0 0 4.25 4.5v2.25L3 8l1.25 1.25v2.25a1.25 1.25 0 0 0 1.25 1.25H6M10 3.25h.5a1.25 1.25 0 0 1 1.25 1.25v2.25L13 8l-1.25 1.25v2.25a1.25 1.25 0 0 1-1.25 1.25H10" />`;

const dot = (x: number, y: number): SVGTemplateResult =>
  svg`<circle class="icon__dot" cx=${x} cy=${y} r=".5" fill="currentColor" stroke="none" />`;

const SETTINGS = svg`<path d="M2.75 4.5h3M9 4.5h4.25M2.75 11.5h6M12 11.5h1.25" /><circle cx="7.5" cy="4.5" r="1.5" /><circle cx="10.5" cy="11.5" r="1.5" />`;

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
  settings: () => SETTINGS,
  // The frame split down the middle: lines of text on the left, a picture's peak on the right.
  preview: () =>
    svg`${FRAME}<path d="M8 2.75v10.5M4.25 6.25h1.5M4.25 9h1.5M9.75 10.25 11 8.5l1.25 1.75" />`,
  // A padlock on the frame's corner radius, with the problems icon's dot for the keyhole.
  lock: () =>
    svg`<rect x="3" y="7.25" width="10" height="6.25" rx="2" /><path d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75" /><circle class="icon__dot" cx="8" cy="10.35" r=".5" fill="currentColor" stroke="none" />`,
  // A folder on the frame's box and corner radius: the tab rises on the left, the flap's line
  // runs across under it.
  folder: () => svg`${FOLDER}<path d="M2 7h12" />`,
  // A node and the two it holds, joined by one stroke that turns into each branch.
  explorer: () =>
    svg`<rect x="2.5" y="2.75" width="5" height="3" rx="1" /><path d="M4.5 5.75v5.375a.75.75 0 0 0 .75.75H8.5M4.5 7.875h4" /><rect x="8.5" y="6.5" width="5" height="2.75" rx="1" /><rect x="8.5" y="10.5" width="5" height="2.75" rx="1" />`,
  chevronRight: () => svg`<path d="M6.5 4 10.5 8 6.5 12" />`,
  chevronDown: () => svg`<path d="M4 6.5 8 10.5 12 6.5" />`,
  // Provisional: the fallback page until Rafael picks the brief's own shape (TYTO-282).
  brief: () => PAGE,
  // The flap line and a split down the folder: a layout.
  templateFolder: () => svg`${FOLDER}<path d="M2 7h12M7.5 7v6.25" />`,
  // Markup: angle brackets and a slash.
  templateHtml: () =>
    svg`<path d="M5 4.75 1.75 8 5 11.25M11 4.75 14.25 8 11 11.25M9.25 3.5l-2.5 9" />`,
  // The template as code that lays out: the frame with a header and a column.
  templateTs: () => svg`${FRAME}<path d="M2 6.25h12M6.25 6.25v7" />`,
  // A list of fields, the problems icon's dot before each line.
  manifest: () =>
    svg`<path d="M6.25 4.25h7M6.25 8h7M6.25 11.75h7" />${dot(3.25, 4.25)}${dot(3.25, 8)}${dot(3.25, 11.75)}`,
  image: () =>
    svg`${FRAME}<circle cx="5.5" cy="6" r="1" /><path d="M2.75 12.25 6.5 8.75l2.5 2.25 1.5-1.25 2.75 2.5" />`,
  // The one letter in the set, which every system draws for a font.
  font: () => svg`<path d="M3.25 13.25 8 2.75l4.75 10.5M5.1 9.25h5.8" />`,
  json: () => BRACES,
  settingsFile: () => SETTINGS,
  // A keyboard: a row of keys and the space bar.
  keybindingsFile: () =>
    svg`${FRAME}${dot(4.75, 6)}${dot(7, 6)}${dot(9.25, 6)}${dot(11.5, 6)}<path d="M5.5 10h5" />`,
  // Braces holding a piece.
  snippetsFile: () => svg`${BRACES}<path d="M6.75 8h2.5" />`,
  // A map pin: the file that names the folder's places.
  projectFile: () =>
    svg`<path d="M8 13.25S3.75 9.5 3.75 6.25a4.25 4.25 0 0 1 8.5 0C12.25 9.5 8 13.25 8 13.25Z" /><circle cx="8" cy="6.25" r="1.5" />`,
  text: () => svg`${PAGE}<path d="M5.5 8h4M5.5 10.5h4" />`,
  // The back of the folder and its front tipped open.
  folderOpen: () =>
    svg`<path d="M2 12V5a2 2 0 0 1 2-2h2.25l1.5 1.75H11a1.5 1.5 0 0 1 1.5 1.5V7" /><path d="M2.25 12.5 4 7.6a.9.9 0 0 1 .85-.6h8.9a.6.6 0 0 1 .56.8l-1.6 4.6a1.25 1.25 0 0 1-1.18.85H3.1a.9.9 0 0 1-.85-.75Z" />`,
  // The folder with the image icon's peak.
  folderAssets: () => svg`${FOLDER}<path d="M4.5 11.25 6.75 9l1.75 1.5 1.25-1 1.75 1.75" />`,
  // The folder with the export icon's arrow.
  folderOutput: () => svg`${FOLDER}<path d="M8 11.5V7.75M6.5 9.25 8 7.75l1.5 1.5" />`,
  // The page alone: anything the table does not know.
  file: () => PAGE,
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
