import type { GoogleFontsOptions } from '@tyto/google-fonts';
import type { HostCapabilities } from '@tyto/plugin-api';

import { pluginCapabilities } from './plugins/capabilities.js';

/**
 * Whether a render asks Google Fonts for a face this machine lacks, and where (TYTO-281,
 * ADR 0120).
 *
 * **On by default**: a missing family Google serves is fetched once into `TYTO_HOME` and drawn
 * from there. Each fetch tells Google a family, a weight, a style and this machine's address.
 * Off with `--no-google-fonts` or `TYTO_GOOGLE_FONTS=off`, and then a missing face is
 * `W_FONT_SUBSTITUTED` exactly as before the feature existed.
 *
 * `TYTO_GOOGLE_FONTS_BASE` points the plugin at a server standing in for Google, **for tests
 * only**, and is read here, from the environment, and from nowhere else: a project file or a
 * plugin's section never chooses where Tyto connects.
 */

export const GOOGLE_FONTS_SWITCH = 'TYTO_GOOGLE_FONTS';
export const GOOGLE_FONTS_BASE = 'TYTO_GOOGLE_FONTS_BASE';

type Variables = Readonly<Record<string, string | undefined>>;

/** The plugin's options, or `undefined` when Google Fonts is off for this run. */
export function googleFontsFor(
  variables: Variables = {},
  flag = true,
): GoogleFontsOptions | undefined {
  if (!flag || variables[GOOGLE_FONTS_SWITCH]?.toLowerCase() === 'off') return undefined;
  const base = variables[GOOGLE_FONTS_BASE];
  return base === undefined || base === '' ? {} : { base };
}

/**
 * Spread into `RenderTaskOptions`: the plugin's options and the network it reaches Google
 * through, or nothing when it is off.
 */
export function googleFontsOption(
  flag: boolean | undefined,
  variables: Variables | undefined,
): { readonly googleFonts?: GoogleFontsOptions; readonly capabilities?: HostCapabilities } {
  const googleFonts = googleFontsFor(variables, flag !== false);
  return googleFonts === undefined
    ? {}
    : { googleFonts, capabilities: pluginCapabilities(variables ?? {}) };
}
