import { createFaceCache, describeFace } from '@tyto/core';
import { createFontLibrary } from '@tyto/fonts';

/**
 * The faces the app draws and measures in, for the life of the main process.
 *
 * One library for the preview and the export, so the two cannot disagree about which file a
 * face came from: the bundled faces (ADR 0021) and the ones this machine has installed, with
 * a bundled substitute, reported, where it lacks one (ADR 0037). The machine's font folders
 * are read once — a face installed while the app is open is seen after a restart.
 */
export const fonts = createFontLibrary({ describe: describeFace });

/** Measurement against the same files `fonts.font` embeds (ADR 0019). */
export const faces = createFaceCache(fonts.source);
