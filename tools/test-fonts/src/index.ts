import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The bytes of the fonts in `fonts/`, as the exporters want them: a `data:` URI,
 * synchronously.
 *
 * `HtmlResources.font` and `SvgResources.font` are called from inside a scene walk and
 * cannot await, so every face is read with `readFileSync` and kept. Four faces at about a
 * hundred kilobytes each is a rounding error next to launching Chromium, and it is the
 * only shape the port accepts.
 *
 * ## Why this is a package of its own
 *
 * `export-html` and `export-svg` are pure (ADR 0010) and open no files, so their own tests
 * cannot read a font and pass a stub string instead — which proves the plumbing and not
 * that any browser can load what comes out. The packages that *can* read the bytes are
 * `raster` today and `core`'s measurement adapter once E4.5 lands, and neither of them
 * owns a font. So the reader sits where both reach it and neither contains it.
 *
 * It lives under `tools/` rather than `packages/` because nothing ships it: it exists to
 * make tests render real glyphs, and a published package that reads a path relative to the
 * repository root would be a bug waiting for its first consumer.
 */

/** The three things that pick a face apart, in the vocabulary both exporters use. */
export interface TestFontFace {
  readonly family: string;
  /** CSS weights, 100..900. */
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

interface BundledFace extends TestFontFace {
  /** Folder under `fonts/`, then the two filenames, kept exactly as upstream released them. */
  readonly folder: string;
  readonly outlines: string;
  readonly web: string;
}

/**
 * Every face the repository bundles.
 *
 * Written out rather than discovered by listing `fonts/`: a folder scan would make
 * dropping a file into the tree enough to change what the suite renders, and which faces
 * exist is a decision with a licence attached to it (`fonts/README.md`).
 *
 * Italic is absent on purpose — `raster`'s visual suite asks for one to watch the resolver
 * answer `undefined` and the exporter report `E_EXPORT_FONT_UNRESOLVED`.
 */
const BUNDLED: readonly BundledFace[] = [
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

/** The families a scene may name. `Scene.fonts` has to declare one of these. */
export const TEST_FONT_FAMILIES: readonly string[] = [
  ...new Set(BUNDLED.map((face) => face.family)),
];

/**
 * The repository root, found by the file that only exists there.
 *
 * Counting `..` from this module would be counting them from `dist/index.js` after tsup
 * has bundled it, which is a different depth from `src/index.ts` and a silent wrong answer
 * the day either moves. Walking up for a marker is right from both.
 */
function repositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    try {
      readFileSync(join(directory, 'pnpm-workspace.yaml'));
      return directory;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) {
        throw new Error(
          'No pnpm-workspace.yaml above @tyto/test-fonts, so the fonts/ folder cannot be ' +
            'located. This package reads the repository it lives in and does not work ' +
            'outside a checkout of it.',
        );
      }
      directory = parent;
    }
  }
}

const FONTS_DIR = join(repositoryRoot(), 'fonts');

function find(face: TestFontFace): BundledFace | undefined {
  return BUNDLED.find(
    (bundled) =>
      bundled.family === face.family &&
      bundled.weight === face.weight &&
      bundled.style === face.style,
  );
}

/**
 * The absolute path of a face's outlines — the `.ttf`, not the `.woff2`.
 *
 * This is the half E4.5 measures with. It is deliberately the same lookup the exporters
 * embed through, so a measurement and a render cannot drift onto two different builds of
 * the same design.
 */
export function testFontOutlinePath(face: TestFontFace): string | undefined {
  const bundled = find(face);
  return bundled === undefined ? undefined : resolve(FONTS_DIR, bundled.folder, bundled.outlines);
}

const uris = new Map<string, string>();

/**
 * A `data:` URI for one face's `.woff2`, or `undefined` for a face nothing bundles.
 *
 * `undefined` is the answer the exporters are built around: it becomes
 * `E_EXPORT_FONT_UNRESOLVED` naming the face, which is what a document that could not load
 * offline is supposed to say. Returning a placeholder would render the wrong glyphs and
 * report nothing.
 */
export function testFontDataUri(face: TestFontFace): string | undefined {
  const bundled = find(face);
  if (bundled === undefined) return undefined;

  const path = resolve(FONTS_DIR, bundled.folder, bundled.web);
  const cached = uris.get(path);
  if (cached !== undefined) return cached;

  const uri = `data:font/woff2;base64,${readFileSync(path).toString('base64')}`;
  uris.set(path, uri);
  return uri;
}

/**
 * `HtmlResources.font`, which asks with a `FontRef` rather than a family name.
 *
 * Typed structurally instead of importing `HtmlFontFace` from `@tyto/export-html`: this
 * package has no business depending on an exporter to describe bytes on a disk, and the
 * shape is three fields.
 */
export function htmlTestFont(face: {
  readonly font: { readonly family: string };
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}): string | undefined {
  return testFontDataUri({ family: face.font.family, weight: face.weight, style: face.style });
}

/** `SvgResources.font`, which asks with the family name directly. */
export function svgTestFont(face: TestFontFace): string | undefined {
  return testFontDataUri(face);
}
