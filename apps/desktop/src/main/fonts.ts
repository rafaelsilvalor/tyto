import { type FaceCache, createFaceCache, describeFace } from '@tyto/core';
import { type FontLibrary, createFontLibrary, systemFontDirectories } from '@tyto/fonts';

/**
 * The faces the app draws and measures in, for the life of the main process.
 *
 * One library for the preview and the export, so the two cannot disagree about which file a
 * face came from: the bundled faces (ADR 0021) and the ones this machine has installed, with
 * a bundled substitute, reported, where it lacks one (ADR 0037). The machine's font folders
 * are read once — a face installed while the app is open is seen after a restart. A face a
 * plugin's `font-source` fetched is the exception: its library is refreshed when it arrives
 * (ADR 0117, {@link refreshFonts}).
 */
export const fonts = createFontLibrary({ describe: describeFace });

/** Measurement against the same files `fonts.font` embeds (ADR 0019). */
export const faces = createFaceCache(fonts.source);

/** A library and the measurement cache over it, which must always travel together. */
export interface FontsInForce {
  readonly fonts: FontLibrary;
  /** Replaced, not cleared, when a plugin adds a face: it remembers every face it was asked. */
  faces: FaceCache;
}

const MACHINE: FontsInForce = { fonts, faces };
const byFolders = new Map<string, FontsInForce>();

/**
 * The fonts for a brief in a workspace whose `project.json` names font folders (TYTO-278,
 * ADR 0113), and for the plugins whose `font-source` cache folders are `sourceDirectories`
 * (ADR 0117): the project's folders first, then the machine's, then the cache's — so a
 * project's face wins over an installed one, and **an installed one over a plugin's**. One
 * library per set of folders for the life of the process, as the machine's is; with none,
 * the machine's own.
 */
export function fontsFor(
  directories: readonly string[],
  sourceDirectories: readonly string[] = [],
): FontsInForce {
  if (directories.length === 0 && sourceDirectories.length === 0) return MACHINE;
  const key = JSON.stringify([directories, sourceDirectories]);
  const known = byFolders.get(key);
  if (known !== undefined) return known;
  const library = createFontLibrary({
    describe: describeFace,
    directories: [...directories, ...systemFontDirectories(), ...sourceDirectories],
  });
  const built: FontsInForce = { fonts: library, faces: createFaceCache(library.source) };
  byFolders.set(key, built);
  return built;
}

/**
 * After a font source wrote a face: the library lists its folders again, and a new face cache
 * measures with it, because the old one answered that face with its substitute.
 */
export function refreshFonts(inForce: FontsInForce): FaceCache {
  inForce.fonts.refresh();
  inForce.faces = createFaceCache(inForce.fonts.source);
  return inForce.faces;
}
