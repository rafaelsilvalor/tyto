import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/**
 * How a plugin's panel page reaches the window, and the three rules that keep it in its box
 * (TYTO-49, ADR 0045).
 *
 * A panel is `tyto-plugin://<plugin>/<path>`, served by main out of that plugin's folder
 * and nowhere else, into an iframe whose sandbox is `allow-scripts` and nothing more. So the
 * page has an opaque origin: no `window.parent` DOM, no `localStorage` of the app's, no
 * cookie, and no preload, which Electron does not run in a subframe. What is here is what
 * main decides: which file a URL is, what policy the page carries, and where a plugin's
 * frame may navigate. Pure apart from `realpath`, so each rule is a unit test.
 */

export const PLUGIN_SCHEME = 'tyto-plugin';

/** Where a panel's page is, as the iframe's `src`. */
export function panelUrl(plugin: string, entry: string): string {
  const path = entry
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${PLUGIN_SCHEME}://${plugin}/${path}`;
}

/**
 * The file inside `root` a URL's path names, or `undefined` when it names anything else.
 *
 * **Every segment is decoded and then judged**, so `%2e%2e` is `..` and refused the same way,
 * and a segment that decodes to a separator — `%2f`, `%5c` — cannot smuggle a second level in.
 * Refused outright: `.` and `..`, an empty segment, a drive or a colon, a NUL. What survives
 * is joined under the root and **resolved through the disk**, so a symbolic link or junction
 * inside the folder that points out of it is refused too: the check is on where the file
 * really is, not on what its name says.
 */
export async function confinedPath(root: string, urlPath: string): Promise<string | undefined> {
  const raw = urlPath.replace(/^\/+/u, '');
  if (raw === '') return undefined;

  const segments: string[] = [];
  for (const encoded of raw.split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[/\\:\0]/u.test(segment)) {
      return undefined;
    }
    segments.push(segment);
  }

  const candidate = join(root, ...segments);

  let real: string;
  let realRoot: string;
  try {
    [real, realRoot] = await Promise.all([realpath(candidate), realpath(root)]);
  } catch {
    return undefined;
  }
  const inside = relative(realRoot, real);
  if (inside === '' || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) {
    return undefined;
  }
  return real;
}

/**
 * The Content-Security-Policy a panel page is served with.
 *
 * Its own files and nothing else: scripts, styles and images from its plugin's origin,
 * **no network at all** (`connect-src 'none'`), no frames of its own and no form target. A
 * panel that needs the network asks through the bridge, where `net:<host>` is checked.
 */
export function panelPolicy(plugin: string): string {
  const own = `${PLUGIN_SCHEME}://${plugin}`;
  return [
    "default-src 'none'",
    `script-src ${own}`,
    `style-src ${own} 'unsafe-inline'`,
    `img-src ${own} data:`,
    `font-src ${own} data:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** The content type for a file a panel ships, by extension; anything else is bytes. */
export function contentTypeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const types: Readonly<Record<string, string>> = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    woff2: 'font/woff2',
  };
  return types[extension] ?? 'application/octet-stream';
}

/**
 * Whether a subframe may go from `from` to `to`.
 *
 * The window's own frames are the preview's `srcdoc` documents, so `about:` stays allowed. A
 * frame may be sent to a plugin page — that is how a panel is first loaded — but a frame
 * already showing plugin `x` may only move within `x`: a panel that sets
 * `location = 'https://example.com'` is refused, and so is one that tries to become another
 * plugin's panel.
 */
export function frameNavigationAllowed(from: string, to: string): boolean {
  if (to === 'about:blank' || to === 'about:srcdoc') return true;
  let target: URL;
  try {
    target = new URL(to);
  } catch {
    return false;
  }
  if (target.protocol !== `${PLUGIN_SCHEME}:`) return false;

  let source: URL | undefined;
  try {
    source = new URL(from);
  } catch {
    source = undefined;
  }
  if (source === undefined || source.protocol !== `${PLUGIN_SCHEME}:`) return true;
  return source.host === target.host;
}
