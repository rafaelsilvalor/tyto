import { join } from 'node:path';

import { BrowserWindow, shell } from 'electron';

/**
 * The window, and the three flags that make the renderer a browser rather than a shell.
 *
 * ADR 0001 and `CLAUDE.md` both name them, and they are the reason the rest of this app is
 * shaped the way it is: with `nodeIntegration: false` the renderer has no `require`, with
 * `contextIsolation: true` the preload's globals live in a separate world the page cannot
 * reach into, and with `sandbox: true` the renderer process itself runs under the OS
 * sandbox. Together they mean a compromised page — a malicious `src` in a template, say —
 * gets a browser tab's powers and not a Node process's.
 *
 * They are written out rather than left to Electron's defaults. Two of the three *are* the
 * default in Electron 44, and a default is a decision somebody else can change in a minor
 * version.
 *
 * `e2e/window.desktop.test.ts` asserts the three **by name**, read back off the running
 * window, as well as asserting what they produce. Both, because the consequence alone does
 * not pin them: `require` is undefined if `nodeIntegration` is false *or* if `sandbox` is
 * true, so a suite that only looked in the renderer would stay green with either one turned
 * off. That was measured by turning each off in turn, not assumed.
 */

export interface WindowOptions {
  /** The built preload script. Absolute, because Electron resolves it against nothing. */
  readonly preload: string;
  /** Where the renderer comes from: a dev server URL, or a built `index.html` on disk. */
  readonly renderer: { readonly url: string } | { readonly file: string };
  /** Shown windows need a screen; the end-to-end test does not have one. */
  readonly show?: boolean;
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: options.show ?? true,
    // No title here. The window's title is a user-facing string, so it comes from the
    // catalogue in the renderer's `<title>` rather than from a literal in main.
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The renderer has no business reading `file://` URLs it was not served, and the
      // editor's own assets come through the bundler.
      webSecurity: true,
    },
  });

  // A link to the outside opens in the user's browser, never in the app. A window that
  // navigated away from the bundle would keep this preload and this `contextIsolation`
  // while showing somebody else's page, which is the one navigation that must not happen.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void ('url' in options.renderer
    ? window.loadURL(options.renderer.url)
    : window.loadFile(options.renderer.file));

  return window;
}

/** Where the built renderer lands, relative to the built main bundle. */
export function bundledRenderer(mainDirectory: string): string {
  return join(mainDirectory, '..', 'renderer', 'index.html');
}
