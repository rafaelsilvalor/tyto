import { parseBrief } from '@tyto/brief-lang';
import {
  type AssetRef,
  type AssetResolver,
  type BrandKit,
  type Diagnostics,
  type FaceCache,
  type FormatCatalogue,
  type Result,
  type Scene,
  type SceneFontFace,
  type Template,
  type TemplateRegistry,
  compile,
  err,
  ok,
  resolve,
} from '@tyto/core';
import { exportHtml } from '@tyto/export-html';

/**
 * `@tyto/template-kit/testing` — a brief compiled against one template the way the app
 * compiles it, inside a test (TYTO-447, ADR 0152).
 *
 * A template in its own repository keeps its fixture + snapshot tests without a Tyto checkout:
 * a brief goes through the real `parseBrief`, `resolve`, `compile` and `exportHtml`, in the
 * order `apps/desktop/src/main/preview.ts` calls them, and what comes back is the `Scene` and
 * one HTML document per frame.
 *
 * **Its snapshots are not the app's exports, by design.** By default nothing is measured — no
 * faces, so text keeps the lines its template produced — and every face is "embedded" as a
 * stable placeholder rather than a font's bytes. A snapshot then changes when the template
 * does, not when a machine has another font. A test that wants the real layout passes
 * `faces` and `font`.
 *
 * Pure like the rest of the kit (ADR 0010): the caller hands over the template, the formats
 * and any bytes; nothing here reads a folder.
 */

/** What `resolve` finds for an asset when the caller gave no resolver: nothing. */
const noAssets: AssetResolver = {
  base: '(template test)',
  resolve: () => Promise.resolve(undefined),
};

/**
 * The `font` resolver a test gets by default: a placeholder that names the face.
 *
 * Not `undefined`, which the exporter treats as a fatal missing font, and not real bytes,
 * which would put a font file's base64 in every snapshot and tie it to one machine's fonts.
 */
export function placeholderFont(face: SceneFontFace): string {
  return `tyto-test-font:${face.font.family}-${String(face.weight)}-${face.style}`;
}

export interface CompileTemplateOptions {
  /** The brief's text. A brief whose frontmatter names no template is compiled against this one. */
  readonly brief: string;
  /** The template under test: `defineTemplate(parseManifest(yaml).value, build, files?)`. */
  readonly template: Template;
  /**
   * The sizes the brief's formats stand for — `formatCatalogue({ grid: { w: 1080, … } })` or
   * `parseFormats(yaml)`. The caller's, because a canvas is a brand's choice and the kit makes
   * none (ADR 0047): a template repository declares the formats it renders.
   */
  readonly formats: FormatCatalogue;
  /** Faces to measure text against; absent, nothing is measured. */
  readonly faces?: FaceCache;
  /** Embeds a face in the document; absent, {@link placeholderFont}. */
  readonly font?: (face: SceneFontFace) => string | undefined;
  /** Where the brief's images are found; absent, every reference is missing. */
  readonly assets?: AssetResolver;
  /** Embeds an image in the document, for the refs `assets` and the template's files gave. */
  readonly asset?: (ref: AssetRef) => string | undefined;
  /** Brand kits by brand id, as the app hands a template the kit under its own brand. */
  readonly brandKits?: ReadonlyMap<string, BrandKit>;
}

/** One frame of one artwork, as the document the HTML exporter wrote. */
export interface CompiledFrame {
  readonly artwork: string;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly html: string;
}

export interface CompiledTemplate {
  readonly scene: Scene;
  readonly frames: readonly CompiledFrame[];
}

/** The registry `resolve` reads, holding the one template under test. */
function registryOf(template: Template): TemplateRegistry {
  const { manifest } = template;
  return {
    list: () => [manifest],
    get: (name) => (name === manifest.name ? manifest : undefined),
    formatsOf: (name) => (name === manifest.name ? manifest.formats : undefined),
    directoryOf: () => undefined,
    failures: [],
  };
}

/**
 * The brief compiled against `template`: its scene and its HTML, or every diagnostic that
 * stopped it. The ok branch carries the warnings of every stage, in stage order.
 */
export async function compileTemplate(
  options: CompileTemplateOptions,
): Promise<Result<CompiledTemplate, Diagnostics>> {
  const { template } = options;

  const ast = parseBrief(options.brief);
  if (!ast.ok) return ast;

  const resolved = await resolve(ast.value, {
    registry: registryOf(template),
    assets: options.assets ?? noAssets,
    template: template.manifest.name,
  });
  if (!resolved.ok) return err([...ast.diagnostics, ...resolved.error]);

  const scene = compile(resolved.value, template, {
    formats: options.formats,
    ...(options.faces === undefined ? {} : { faces: options.faces }),
    ...(options.brandKits === undefined ? {} : { brandKits: options.brandKits }),
  });
  if (!scene.ok) return err([...ast.diagnostics, ...resolved.diagnostics, ...scene.error]);

  const exported = exportHtml(scene.value, {
    resources: {
      font: options.font ?? placeholderFont,
      ...(options.asset === undefined ? {} : { asset: options.asset }),
    },
  });
  const before = [...ast.diagnostics, ...resolved.diagnostics, ...scene.diagnostics];
  if (!exported.ok) return err([...before, ...exported.error]);

  return ok(
    {
      scene: scene.value,
      frames: exported.value.map(({ artwork, frame, html }) => ({
        artwork: artwork.id,
        format: frame.format,
        width: frame.size.w,
        height: frame.size.h,
        html,
      })),
    },
    [...before, ...exported.diagnostics],
  );
}
