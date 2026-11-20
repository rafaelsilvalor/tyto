/**
 * Where a format's own copy of a slot's external art is looked for (ADR 0222).
 *
 * A brief names one file for an external slot, and a story and a square post are painted
 * separately, so each format may have its own: `grafico.png` cited, `grafico.story.png`
 * beside it is the story's. The brief's syntax does not change; `resolve` asks the asset
 * port for this reference once per rendered format, and `compile` draws the one it found for
 * that format, else the cited file.
 *
 * Pure string work on the reference as the brief wrote it, so the copy is searched for in the
 * same folders, in the same order, as the cited file.
 */

/** A URI scheme a plugin's `asset-source` answers for (ADR 0117), as plugin-api reads one. */
const SCHEME = /^[a-z][a-z0-9+.-]+$/u;

/**
 * The reference of `reference`'s copy for `format`: `<stem>.<format><extension>`, or
 * `<reference>.<format>` when the file name has no extension. `undefined` for a reference
 * with a URI scheme, which names an item in a plugin's source, not a file with siblings:
 * probing it would ask the plugin for an item nobody named.
 */
export function externalArtVariant(reference: string, format: string): string | undefined {
  const colon = reference.indexOf(':');
  // Two letters at least, so `C:\art\fundo.png` is a path, as plugin-api's `schemeOf` reads it.
  if (colon >= 2 && SCHEME.test(reference.slice(0, colon).toLowerCase())) return undefined;
  const folderEnd = Math.max(reference.lastIndexOf('/'), reference.lastIndexOf('\\')) + 1;
  const name = reference.slice(folderEnd);
  const dot = name.lastIndexOf('.');
  // A leading dot is a hidden file's name, not its extension.
  if (dot <= 0) return `${reference}.${format}`;
  return `${reference.slice(0, folderEnd + dot)}.${format}${name.slice(dot)}`;
}
