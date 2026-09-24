import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';

import {
  type BundledFontFace,
  type BundledFontQuery,
  BUNDLED_FONT_FAMILIES,
  bundledFont,
  bundledFontSource,
  bundledFontUri,
} from './bundled.js';

/**
 * Faces installed on the machine that renders, beside the ones Tyto ships (ADR 0037).
 *
 * ADR 0021 kept every face inside this package so that the same brief gives the same bytes
 * everywhere. That rule cannot hold for a commercial typeface in a public repository: the
 * licence lets the machine have it and forbids the repository from carrying it. So a
 * `FontRef { source: 'system' }` is looked up in the platform's font folders, and where the
 * machine lacks it a bundled face is drawn in its place — the same one for measurement and
 * for export, so the line breaks still match the pixels — and the substitution is reported
 * rather than hidden.
 *
 * Bundled faces behave exactly as they did: a `source: 'bundled'` face is never looked for
 * on the machine, and one this package does not ship is still `undefined`, which the
 * exporters report as `E_EXPORT_FONT_UNRESOLVED`.
 */

/** A face that was asked for and the bundled one drawn in its place. */
export interface FontSubstitution {
  readonly requested: BundledFontFace;
  readonly drawn: BundledFontFace;
}

export interface FontLibrary {
  /**
   * `HtmlResources.font` and `SvgResources.font`: a `data:` URI, or `undefined`. A function
   * property rather than a method, because it is handed to the exporters on its own.
   */
  readonly font: (face: BundledFontQuery) => string | undefined;
  /** `FontSource` from `@tyto/core`, answering from the same file {@link font} embeds. */
  readonly source: { outlines(face: BundledFontFace): Uint8Array | undefined };
  /** The faces among `faces` that this machine lacks, with what was drawn instead. */
  substitutions(faces: readonly BundledFontQuery[]): readonly FontSubstitution[];
}

export interface FontLibraryOptions {
  /**
   * Names the face a font file holds, from its bytes — `describeFace` from `@tyto/core`.
   *
   * Handed in rather than imported: reading a face's tables needs fontkit, and this package
   * is the one the desktop ships outside its bundle (`electron-builder.yml`), so an import
   * here is a module the packaged app does not have. `core` is bundled and already carries
   * fontkit for measurement, so the composition root passes its function.
   */
  readonly describe: (bytes: Uint8Array) => BundledFontFace | undefined;
  /**
   * The folders searched for installed faces. Defaults to the platform's own
   * ({@link systemFontDirectories}); a test passes an empty list to be a machine without.
   */
  readonly directories?: readonly string[];
}

/**
 * Where this platform keeps installed fonts, per user and for the whole machine.
 *
 * Windows installs a font for one user under `%LOCALAPPDATA%` unless it is installed "for
 * all users" — measured on the maintainer's machine, all 40 CircularXX files are in the
 * per-user folder and none in `%WINDIR%\Fonts`. Folders that do not exist are skipped when
 * they are read, so listing one here costs nothing.
 */
export function systemFontDirectories(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): readonly string[] {
  if (platform === 'win32') {
    return [
      join(
        environment.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
        'Microsoft',
        'Windows',
        'Fonts',
      ),
      join(environment.WINDIR ?? 'C:\\Windows', 'Fonts'),
    ];
  }
  if (platform === 'darwin') {
    return [join(home, 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts'];
  }
  return [
    join(home, '.local', 'share', 'fonts'),
    join(home, '.fonts'),
    '/usr/local/share/fonts',
    '/usr/share/fonts',
  ];
}

/** Case and spacing are how two tools spell one family differently; neither is a design. */
function normalise(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function faceKey(face: BundledFontFace): string {
  return `${normalise(face.family)}|${String(face.weight)}|${face.style}`;
}

/** Formats fontkit reads as one face. A `.ttc` is a collection and is left alone. */
const OUTLINE_EXTENSIONS = new Set(['.otf', '.ttf']);

function filesUnder(directory: string): readonly string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // A folder the platform might have and this machine does not.
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    // Linux distributions nest by foundry or package; Windows and macOS are flat.
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (OUTLINE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

interface Installed {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The bundled face drawn for one this machine lacks: the nearest weight, upright. */
function substituteFor(face: BundledFontFace): BundledFontFace {
  const family = BUNDLED_FONT_FAMILIES[0] ?? 'Source Sans 3';
  // Source Sans 3 ships 400 and 700. Nearest, with a tie going to the heavier face, as
  // CSS does for weights above 500.
  const weight = Math.abs(face.weight - 400) < Math.abs(face.weight - 700) ? 400 : 700;
  return { family, weight, style: 'normal' };
}

const MIME: Record<string, string> = { '.otf': 'font/otf', '.ttf': 'font/ttf' };

export function createFontLibrary(options: FontLibraryOptions): FontLibrary {
  const directories = options.directories ?? systemFontDirectories();
  let files: readonly string[] | undefined;
  /** By normalised family: every face of it this machine has, read once. */
  const families = new Map<string, Map<string, Installed>>();
  const uris = new Map<string, string>();

  /**
   * Every face of `family` installed here.
   *
   * Only files whose name starts with the family are opened: `%WINDIR%\Fonts` alone is 534
   * files and 388 MB on the maintainer's machine, and parsing all of them for one family
   * would be most of a render. A face whose file is named after something else is not
   * found, which ADR 0037 declares rather than works around.
   */
  function installed(family: string): Map<string, Installed> {
    const wanted = normalise(family);
    const known = families.get(wanted);
    if (known !== undefined) return known;

    files ??= directories.flatMap(filesUnder);
    const found = new Map<string, Installed>();
    for (const path of files) {
      const name = normalise(
        path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1),
      );
      if (!name.startsWith(wanted)) continue;
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(readFileSync(path));
      } catch {
        continue;
      }
      const face = options.describe(bytes);
      if (face === undefined || normalise(face.family) !== wanted) continue;
      // The first file wins, so the per-user folder, listed first, overrides the machine's.
      const key = faceKey(face);
      if (!found.has(key)) found.set(key, { path, bytes });
    }
    families.set(wanted, found);
    return found;
  }

  function onMachine(face: BundledFontFace): Installed | undefined {
    return installed(face.family).get(faceKey(face));
  }

  const isBundledFamily = (family: string): boolean => BUNDLED_FONT_FAMILIES.includes(family);

  function uriOf(file: Installed): string {
    const cached = uris.get(file.path);
    if (cached !== undefined) return cached;
    const mime = MIME[extname(file.path).toLowerCase()] ?? 'font/ttf';
    const uri = `data:${mime};base64,${Buffer.from(file.bytes).toString('base64')}`;
    uris.set(file.path, uri);
    return uri;
  }

  const faceOfQuery = (query: BundledFontQuery): BundledFontFace => ({
    family: query.font.family,
    weight: query.weight,
    style: query.style,
  });

  return {
    font: (query: BundledFontQuery): string | undefined => {
      if (query.font.source !== 'system') return bundledFont(query);
      const face = faceOfQuery(query);
      const file = onMachine(face);
      return file === undefined ? bundledFontUri(substituteFor(face)) : uriOf(file);
    },

    source: {
      // `FontSource` is asked with a family and no `source`, so the question is answered by
      // family: one this package ships is only ever the bundled face, exactly as before,
      // and any other is the machine's or its substitute — the same answer `font` gives a
      // `system` face, which is what keeps the measurement and the pixels on one file.
      outlines(face: BundledFontFace): Uint8Array | undefined {
        if (isBundledFamily(face.family)) return bundledFontSource.outlines(face);
        return onMachine(face)?.bytes ?? bundledFontSource.outlines(substituteFor(face));
      },
    },

    substitutions(faces: readonly BundledFontQuery[]): readonly FontSubstitution[] {
      const seen = new Set<string>();
      const missing: FontSubstitution[] = [];
      for (const query of faces) {
        if (query.font.source !== 'system') continue;
        const face = faceOfQuery(query);
        const key = faceKey(face);
        if (seen.has(key)) continue;
        seen.add(key);
        if (onMachine(face) === undefined)
          missing.push({ requested: face, drawn: substituteFor(face) });
      }
      return missing;
    },
  };
}
