import type { Locale } from '../../shared/i18n/index.js';

/**
 * Where Help ▸ Documentation sends a person: the published user manual, one edition per
 * language the window speaks (TYTO-318, ADR 0101).
 *
 * **Written out whole, one literal per edition**, for the reason `RELEASES_URL` is: a template
 * literal survives bundling as a template, so a URL composed from a host and a path never
 * appears in `out/main/index.js` as one string, and nothing reading the shipped bundle could
 * find the address the app opens. Whole, the bytes in the package are the address.
 *
 * **This table is the allowlist.** The window asks for "the documentation" and names nothing
 * (`help:open-documentation` carries an empty payload), so the only URLs this path can ever
 * hand the system browser are the two below. Opening a public page in the person's own browser
 * is not a network client inside Tyto (ADR 0011): the app sends no request and reads no answer.
 *
 * The site is published by `.github/workflows/docs-pages.yml` on each desktop release, latest
 * only, so an older app opens the newest manual (ADR 0101, amended).
 */
export const DOCUMENTATION_URLS = {
  en: 'https://rafaelsilvalor.github.io/tyto/',
  'pt-BR': 'https://rafaelsilvalor.github.io/tyto/pt-BR/',
} as const satisfies Record<Locale, string>;

/** The edition matching the window's language: `/pt-BR/` in Portuguese, `/` otherwise. */
export function documentationUrl(locale: Locale): string {
  return DOCUMENTATION_URLS[locale];
}

/** Whether a URL is one of the manual's editions, exactly. A prefix match is not enough. */
export function isDocumentationUrl(url: string): boolean {
  return (Object.values(DOCUMENTATION_URLS) as string[]).includes(url);
}

/**
 * Opens the manual in the window's language through `openExternal`, which is the composition
 * root's `shell.openExternal` — the same door the update notice opens a release page through.
 *
 * The check runs on the URL about to leave, not on the locale, so a table edited into something
 * else, or a caller passing a locale the table lacks, opens nothing and says so.
 */
export function openDocumentation(locale: Locale, openExternal: (url: string) => void): boolean {
  const url = documentationUrl(locale);
  if (!isDocumentationUrl(url)) return false;
  openExternal(url);
  return true;
}
