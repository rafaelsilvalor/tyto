import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @tyto/fonts — the faces Tyto ships, and the reader that hands them out.
 *
 * Design directive 4 in `docs/architecture.md`: *same brief + templates + fonts ⇒ same
 * bytes. Fonts are bundled/pinned; never `system-ui`.* Bundling them is only half of that.
 * The other half is a way for a render to reach the bytes, and until ADR 0021 there was
 * none: the faces sat in a folder at the repository root that only `tools/test-fonts`
 * knew about, so the visual suite embedded real glyphs and `tyto render` answered
 * `E_EXPORT_FONT_UNRESOLVED` four times per run.
 *
 * ## Why this is a package, and why it is a Node one
 *
 * The bytes had to move: a package's `files` cannot reach above its own folder, so fonts
 * at the repository root are fonts that no install ever sees. They live here now, and
 * `files` publishes them.
 *
 * `@tyto/templates` solved the same locating problem by staying pure and letting the
 * composition root resolve its directory (ADR 0020). This package does it itself, because
 * it is not the same kind of thing. A template pack is *data a pure stage compiles*, so
 * the package holding it has to be loadable in a browser and in a cloud worker. Font bytes
 * are never read by a pure stage: `FontSource` and the exporters' `resources.font` are
 * ports, and whatever answers a port is an adapter. This is that adapter, shipped beside
 * the bytes it reads so there is one reader rather than one per consumer.
 *
 * ADR 0021 has the whole argument, including what was rejected.
 */

/** A face, in the vocabulary the IR uses for one: a family and the two style axes. */
export interface BundledFontFace {
  readonly family: string;
  /** CSS weights, 100..900. */
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

interface Bundled extends BundledFontFace {
  /** Folder under `fonts/`, then the two filenames, kept exactly as upstream released them. */
  readonly folder: string;
  readonly outlines: string;
  readonly web: string;
}

/**
 * Every face this package ships.
 *
 * Written out rather than discovered by listing `fonts/`: a folder scan would make dropping
 * a file into the tree enough to change what every render embeds, and which faces exist is
 * a decision with a licence attached to it (`README.md` beside this folder).
 *
 * Italic is absent on purpose — `raster`'s visual suite asks for one in order to watch the
 * resolver answer `undefined` and the exporter report `E_EXPORT_FONT_UNRESOLVED`, which is
 * the behaviour a missing face is supposed to have.
 */
const BUNDLED: readonly Bundled[] = [
  {
    family: 'Source Sans 3',
    weight: 400,
    style: 'normal',
    folder: 'source-sans-3',
    outlines: 'SourceSans3-Regular.ttf',
    web: 'SourceSans3-Regular.ttf.woff2',
  },
  {
    family: 'Source Sans 3',
    weight: 700,
    style: 'normal',
    folder: 'source-sans-3',
    outlines: 'SourceSans3-Bold.ttf',
    web: 'SourceSans3-Bold.ttf.woff2',
  },
];

/** The families a scene may name and have answered. `Scene.fonts` has to declare one. */
export const BUNDLED_FONT_FAMILIES: readonly string[] = [
  ...new Set(BUNDLED.map((face) => face.family)),
];

/**
 * The subfolder of this package that holds one folder per family.
 *
 * Exported for the same reason `@tyto/templates` exports the name of its own: the string
 * belongs to the package that has the folder, and `files` in `package.json` has to name the
 * same one.
 */
export const BUNDLED_FONTS_DIRECTORY = 'fonts';

/**
 * Where this package's `fonts/` folder is, on this machine, right now.
 *
 * `../fonts` from this module, which is right from both places this module is ever loaded:
 * `src/index.ts` and the `dist/index.js` tsup writes are each exactly one level under the
 * package root. That is a fact worth stating rather than counting, and the test beside this
 * file asserts the folder is really there.
 *
 * Resolved from `import.meta.url` and not from a walk up to `pnpm-workspace.yaml`, which is
 * what `tools/test-fonts` did and the reason it could not ship: a marker that only exists
 * in a checkout finds nothing in `node_modules`. This works in a workspace, in a published
 * install, and inside an Electron `asar`, where Electron patches `fs`.
 */
export function bundledFontsDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', BUNDLED_FONTS_DIRECTORY);
}

function find(face: BundledFontFace): Bundled | undefined {
  return BUNDLED.find(
    (bundled) =>
      bundled.family === face.family &&
      bundled.weight === face.weight &&
      bundled.style === face.style,
  );
}

/**
 * One file of a face this package claims to ship.
 *
 * A read that fails here is not a missing face — {@link find} already said the table lists
 * it — so it is this package's own installation being broken, which is an internal failure
 * and not a diagnostic about anybody's brief. Returning `undefined` instead would turn a
 * broken install into `E_EXPORT_FONT_UNRESOLVED`, which would send whoever reads it looking
 * at their template.
 */
function read(bundled: Bundled, file: string): Buffer {
  const path = join(bundledFontsDirectory(), bundled.folder, file);
  try {
    return readFileSync(path);
  } catch (cause) {
    throw new Error(
      `@tyto/fonts lists ${bundled.family} ${String(bundled.weight)} ${bundled.style} but ` +
        `cannot read ${path}. The package's fonts/ folder is missing or incomplete.`,
      { cause },
    );
  }
}

/**
 * The absolute path of a face's outlines — the `.ttf`, not the `.woff2`.
 *
 * This is the half measurement reads. It is deliberately the same lookup the exporters
 * embed through, so a measurement and a render cannot drift onto two different builds of
 * the same design.
 */
export function bundledFontOutlinePath(face: BundledFontFace): string | undefined {
  const bundled = find(face);
  if (bundled === undefined) return undefined;
  return join(bundledFontsDirectory(), bundled.folder, bundled.outlines);
}

const uris = new Map<string, string>();

/**
 * A `data:` URI for one face's `.woff2`, or `undefined` for a face nothing bundles.
 *
 * `undefined` is the answer the exporters are built around: it becomes
 * `E_EXPORT_FONT_UNRESOLVED` naming the face, which is what a document that could not load
 * offline is supposed to say. Returning a placeholder would render the wrong glyphs and
 * report nothing.
 *
 * Read once and kept. `HtmlResources.font` and `SvgResources.font` are called from inside a
 * scene walk and cannot await, so every face is read with `readFileSync`; two faces at about
 * a hundred kilobytes each is a rounding error next to launching Chromium, and a synchronous
 * read is the only shape the port accepts.
 */
export function bundledFontUri(face: BundledFontFace): string | undefined {
  const bundled = find(face);
  if (bundled === undefined) return undefined;

  const key = `${bundled.folder}/${bundled.web}`;
  const cached = uris.get(key);
  if (cached !== undefined) return cached;

  const uri = `data:font/woff2;base64,${read(bundled, bundled.web).toString('base64')}`;
  uris.set(key, uri);
  return uri;
}

/**
 * The face an exporter asks about, as little of it as this package needs.
 *
 * Typed structurally rather than by importing either exporter's alias or `core`'s
 * `SceneFontFace`: this package describes bytes on a disk and has no business depending on
 * the compiler or on an exporter to do it. The shape is three fields, and `FontRef` is
 * assignable to it.
 */
export interface BundledFontQuery {
  readonly font: { readonly family: string; readonly source?: string };
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/**
 * `HtmlResources.font` and `SvgResources.font`, which are the same question.
 *
 * They used to differ: the HTML exporter asked with a `FontRef`, the SVG one with a family
 * name. TYTO-62 gave both exporters `core`'s `SceneFontFace`, and the two collapsed into
 * this one function, which is why the CLI binds it to both halves of `ExportResources`.
 *
 * **A `file` font is refused rather than matched by name.** `FontRef.source` distinguishes a
 * face the brief points at from one Tyto ships, and a brief that says *this family, from
 * this file beside me* must not be answered with a different build of the same design that
 * happened to be bundled. Nothing loads a `file` font yet; until something does, the honest
 * answer is `E_EXPORT_FONT_UNRESOLVED` naming it.
 */
export function bundledFont(face: BundledFontQuery): string | undefined {
  if (face.font.source === 'file') return undefined;
  return bundledFontUri({ family: face.font.family, weight: face.weight, style: face.style });
}

const outlines = new Map<string, Uint8Array>();

/**
 * `FontSource` from `@tyto/core`: the outline bytes measurement is taken from.
 *
 * The `.ttf`, not the `.woff2` the exporters embed — a measurement has to come from the same
 * build that gets drawn, which is why both are committed from one upstream release
 * (`README.md`). Typed structurally rather than by importing the port, for the same reason
 * {@link bundledFont} is.
 */
export const bundledFontSource: {
  outlines(face: BundledFontFace): Uint8Array | undefined;
} = {
  outlines(face: BundledFontFace): Uint8Array | undefined {
    const bundled = find(face);
    if (bundled === undefined) return undefined;

    const key = `${bundled.folder}/${bundled.outlines}`;
    const cached = outlines.get(key);
    if (cached !== undefined) return cached;

    const bytes = new Uint8Array(read(bundled, bundled.outlines));
    outlines.set(key, bytes);
    return bytes;
  },
};
