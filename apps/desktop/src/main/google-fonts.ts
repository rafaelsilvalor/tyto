import type { Diagnostics, TemplateManifest } from '@tyto/core';
import {
  GOOGLE_FONTS_ID,
  type GoogleFontsOptions,
  type Substitution,
  familyKey,
  googleFontWarnings,
  googleFontsPlugin,
} from '@tyto/google-fonts';
import {
  type FontSourceContribution,
  type HostCapabilities,
  type OwnedSource,
  createPluginHost,
} from '@tyto/plugin-api';
import { fontSubstitutionWarnings } from '@tyto/pipeline';

/**
 * The window's Google Fonts (TYTO-281, ADR 0120): the built-in `font-source` that asks Google
 * for a face this machine lacks, composed once for the life of the main process.
 *
 * **Where it may fetch is ADR 0119's, unchanged**: it is one more source behind the window's
 * source cache, so a save, an open from disk and the export box fetch, a keystroke, a
 * restricted folder, the queue and an unsaved buffer do not, a failure is remembered for the
 * process, and a local face wins.
 *
 * **On by default; the `googleFonts` setting turns it off**, read on every compile, so a change
 * applies to the next one with no restart. Off, the source is not there at all: nothing is
 * asked, the faces it fetched before are not drawn, and a missing face is `W_FONT_SUBSTITUTED`
 * exactly as before the feature existed. `TYTO_GOOGLE_FONTS=off` in the environment turns it
 * off too, as it does for the CLI.
 *
 * `TYTO_GOOGLE_FONTS_BASE` points the plugin at a server standing in for Google, **for tests
 * only**, and is read here, from the main process's environment, and from nowhere else: the
 * setting is a boolean, the plugin ignores its `section`, and no project file or plugin is
 * asked where Tyto connects.
 */

export const GOOGLE_FONTS_SWITCH = 'TYTO_GOOGLE_FONTS';
export const GOOGLE_FONTS_BASE = 'TYTO_GOOGLE_FONTS_BASE';

type Variables = Readonly<Record<string, string | undefined>>;

/** The plugin's options from the environment, or `undefined` when it turns Google Fonts off. */
export function googleFontsOptionsFor(variables: Variables): GoogleFontsOptions | undefined {
  if (variables[GOOGLE_FONTS_SWITCH]?.toLowerCase() === 'off') return undefined;
  const base = variables[GOOGLE_FONTS_BASE];
  return base === undefined || base === '' ? {} : { base };
}

export interface WindowGoogleFontsOptions {
  /** From {@link googleFontsOptionsFor}; `undefined` is off for the life of the process. */
  readonly options: GoogleFontsOptions | undefined;
  /** The window's network, the one its plugins and panels reach it through (ADR 0042). */
  readonly capabilities: HostCapabilities;
  /** The `googleFonts` setting, asked on every compile. */
  readonly enabled: () => boolean;
}

export interface WindowGoogleFonts {
  /** Whether a compile right now asks Google: the environment and the setting both allow it. */
  on(): boolean;
  /** The source, behind the window's source cache; empty while {@link on} is false. */
  fontSources(): readonly OwnedSource<FontSourceContribution>[];
  /**
   * One line per missing face: with Google Fonts on, a family nobody serves is
   * `W_FONT_UNAVAILABLE` with the template's alternatives; off, `W_FONT_SUBSTITUTED` as before.
   * `sources` are every font source the compile asked, Google's among them or not.
   */
  missingFaceWarnings(
    substitutions: readonly Substitution[],
    manifest: TemplateManifest | undefined,
    sources: readonly OwnedSource<FontSourceContribution>[],
  ): Diagnostics;
}

export function windowGoogleFonts(composed: WindowGoogleFontsOptions): WindowGoogleFonts {
  const { options } = composed;
  // Activated once, into a host of its own with the window's network: the window plugins'
  // host has none (it never fetches), and the export's host is per run.
  let sources: readonly OwnedSource<FontSourceContribution>[] = [];
  if (options !== undefined) {
    const host = createPluginHost({ capabilities: composed.capabilities });
    host.activate(googleFontsPlugin(options));
    sources = host.registry.fontSources();
  }
  const on = (): boolean => options !== undefined && composed.enabled();

  return {
    on,
    fontSources: () => (on() ? sources : []),
    missingFaceWarnings(substitutions, manifest, asked) {
      if (!on()) return fontSubstitutionWarnings(substitutions);
      return googleFontWarnings(
        substitutions,
        (family) => manifest?.fonts?.[family]?.alternatives,
        (family) =>
          asked.some(
            ({ plugin, source }) =>
              plugin !== GOOGLE_FONTS_ID &&
              source.families.some((name) => familyKey(name) === familyKey(family)),
          ),
      );
    },
  };
}

/** No Google Fonts: what the preview and the export do when nothing composed it. */
export const NO_GOOGLE_FONTS: WindowGoogleFonts = {
  on: () => false,
  fontSources: () => [],
  missingFaceWarnings: (substitutions) => fontSubstitutionWarnings(substitutions),
};
