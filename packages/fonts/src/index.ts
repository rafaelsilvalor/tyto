/**
 * @tyto/fonts — the faces Tyto ships, the ones the machine has installed, and the reader
 * that hands both to the exporters and to measurement.
 *
 * `bundled.ts` is ADR 0021: the faces in this package's own `fonts/` folder. `system.ts` is
 * ADR 0037: a `source: 'system'` face read from the platform's font folders, with a bundled
 * face drawn and reported where the machine lacks it.
 */
export {
  type BundledFontFace,
  type BundledFontQuery,
  BUNDLED_FONT_FAMILIES,
  BUNDLED_FONTS_DIRECTORY,
  bundledFont,
  bundledFontOutlinePath,
  bundledFontSource,
  bundledFontUri,
  bundledFontsDirectory,
} from './bundled.js';
export {
  type FontLibrary,
  type FontLibraryOptions,
  type FontSubstitution,
  createFontLibrary,
  systemFontDirectories,
} from './system.js';
