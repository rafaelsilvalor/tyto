/**
 * Which addresses the app hands to the system's browser (TYTO-379).
 *
 * A recipe's table draws a `link` value as an anchor, and a template or a plugin's panel can
 * open a window; both end in `shell.openExternal`, which opens **whatever the system maps the
 * scheme to**: a `file:` path runs the program that owns it, and a custom scheme starts an app
 * with arguments the link chose. A value fetched from a source is data nobody reviewed, so only
 * the two web schemes leave the app. The renderer asks the same question before drawing an
 * anchor, so a link that would be refused never looks clickable.
 */
export function externalUrlAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}
