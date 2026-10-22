/**
 * No test in this package reaches Google Fonts (ADR 0120).
 *
 * The feature is on by default, and a test that rendered a family Google serves would fetch
 * it for real: from CI that is a network the run does not own and an answer that changes when
 * Google's file does. So the platform's `fetch`, which `pluginCapabilities` reaches the network
 * through, refuses both of Google's hosts here. A test that means to fetch points the plugin at
 * a server of its own with `TYTO_GOOGLE_FONTS_BASE`.
 */

const GOOGLE_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const platformFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (GOOGLE_HOSTS.has(url.hostname)) {
    return Promise.reject(
      new Error(
        `a CLI test asked ${url.hostname}; tests never reach Google Fonts — set TYTO_GOOGLE_FONTS_BASE to a local server`,
      ),
    );
  }
  return platformFetch(input, init);
};
