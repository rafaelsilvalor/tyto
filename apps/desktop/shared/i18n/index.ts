import { type Catalogue, type CatalogueKey, CATALOGUE_KEYS } from './catalogue.js';
import { en } from './en.js';
import { ptBR } from './pt-BR.js';

/**
 * Which locales exist, which one is first, and how a key resolves.
 *
 * Pure and process-agnostic on purpose: main needs it for a window title and a menu, the
 * renderer needs it for everything it draws, and neither should own the table. It lives in
 * `shared/` for the same reason `ipc.ts` does — two runtimes have to agree, and the
 * agreement is the thing that rots when it is written twice.
 */

export const FALLBACK_LOCALE = 'en';
export const DEFAULT_LOCALE = 'pt-BR';

const CATALOGUES = {
  'pt-BR': ptBR,
  en,
} as const satisfies Record<string, Catalogue>;

export type Locale = keyof typeof CATALOGUES;

/** In offer order: the first locale first, which is what a picker shows at the top. */
export const LOCALES = ['pt-BR', 'en'] as const satisfies readonly Locale[];

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The locale to start in, from whatever the operating system said.
 *
 * Matched on the language subtag rather than on the whole tag, so `pt`, `pt-PT` and
 * `pt-BR` all land on Portuguese: a machine set to European Portuguese wanting English
 * because the region did not match exactly would be a worse answer than an imperfect
 * Portuguese one. Anything with no match at all gets `pt-BR`, because that is the locale
 * this app is written first in and the one that is always complete.
 */
export function localeFor(systemLocale: string | undefined): Locale {
  if (systemLocale === undefined) return DEFAULT_LOCALE;
  if (isLocale(systemLocale)) return systemLocale;
  const language = systemLocale.split('-')[0]?.toLowerCase();
  return (
    LOCALES.find((locale) => locale.split('-')[0]?.toLowerCase() === language) ?? DEFAULT_LOCALE
  );
}

/**
 * One string, in one locale.
 *
 * The fallback is a runtime belt for a compile-time braces: `Catalogue` already makes a
 * missing key a type error, so this can only fire for a locale built at runtime — which is
 * what a plugin contributing strings would be. Falling back to English beats rendering a
 * key, and rendering a key beats throwing: a missing translation is not a reason to blank
 * a panel.
 */
export function translate(locale: Locale, key: CatalogueKey): string {
  return CATALOGUES[locale][key] || CATALOGUES[FALLBACK_LOCALE][key] || key;
}

/** A bound `t` for a locale, which is what a render pass actually wants. */
export function translator(locale: Locale): (key: CatalogueKey) => string {
  return (key) => translate(locale, key);
}

export { type Catalogue, type CatalogueKey, CATALOGUE_KEYS };
