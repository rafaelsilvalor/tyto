import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { parseBrief } from '@tyto/brief-lang';
import {
  type AssetResolver,
  type Diagnostic,
  type Diagnostics,
  type FileSystem,
  type FormatCatalogue,
  type TemplateRegistry,
  compile,
  createFaceCache,
  loadFormats,
  loadTemplateRegistry,
  resolve,
} from '@tyto/core';
import { exportHtml } from '@tyto/export-html';
import { bundledFont, bundledFontSource } from '@tyto/fonts';
import { BUILT_IN_TEMPLATES_DIRECTORY } from '@tyto/templates';
import { markupTemplateSource } from '@tyto/pipeline';

/**
 * Brief text in, one HTML document per frame out — the preview's whole job (E9.2).
 *
 * **The preview stops at HTML and never rasterizes**, which is a departure from what the
 * card described and the reason is worth more than the paragraph it costs. A live preview's
 * destination is a window that is already Chromium: turning the document into a PNG so that
 * Chromium can decode the PNG and draw it is a round trip whose only product is latency and
 * a lossy copy. The renderer shows the document itself.
 *
 * Rasterizing is still what an *export* means, and it stays where it was — the `Rasterizer`
 * port, reached by the job (E9.4). The two are different questions that happened to share a
 * paragraph: "what does this look like while I type" and "what bytes do I hand somebody".
 *
 * It also makes the preview independent of E5.4, which is unfinished and, on the maintainer's
 * machine, unverifiable (TYTO-30).
 *
 * Everything here is composition, so it lives in `apps/*` (ADR 0010). The stages it calls are
 * the same pure ones the CLI calls, in the same order, and the ordering is the only thing
 * this file knows that they do not.
 */

/** One frame of one artwork, as a document the renderer can show. */
export interface PreviewFrame {
  /** The artwork this frame belongs to — a slide, for a repeating brief. */
  readonly artwork: string;
  /** The format's name, which is what a tab is labelled with. */
  readonly format: string;
  readonly width: number;
  readonly height: number;
  /** Self-contained: fonts and assets embedded, no request it could make. */
  readonly html: string;
}

export interface PreviewResult {
  readonly frames: readonly PreviewFrame[];
  /**
   * Everything the stages had to say, errors and warnings together.
   *
   * Frames and diagnostics both, never one or the other: a warning is a document that still
   * renders (ADR 0013), and a brief with an error in one artwork should still show the
   * artworks that compiled. A preview that blanked on the first warning would be a preview
   * that is blank while somebody types.
   */
  readonly diagnostics: Diagnostics;
}

export interface PreviewServiceOptions {
  readonly fileSystem: FileSystem;
  /** The folder holding one subfolder per template. Defaults to the built-in pack's. */
  readonly templatesDirectory?: string;
  /** The project's `formats.yaml`. Defaults to the built-in pack's. */
  readonly formatsFile?: string;
}

export interface PreviewService {
  /** The frames `brief` produces right now, and what was wrong with it. Never rejects. */
  preview(brief: string): Promise<PreviewResult>;
}

/**
 * Where `@tyto/templates` put its folder on this machine.
 *
 * The same resolver `plugins.ts` uses and for the same reason — through the package's own
 * `package.json`, which is the one form that is right in a pnpm workspace, in a published
 * install, and inside an Electron `asar`. `electron-builder.yml` re-includes that package
 * for exactly this call (TYTO-15).
 */
function builtInTemplates(): string {
  const packageJson = createRequire(import.meta.url).resolve('@tyto/templates/package.json');
  return join(dirname(packageJson), BUILT_IN_TEMPLATES_DIRECTORY);
}

/**
 * A resolver that finds nothing, which is the honest answer until a brief has a folder.
 *
 * The preview compiles text, not a file on disk, so there is no `assets/` beside it to read.
 * A brief that references an asset gets the exporter's own diagnostic naming the missing
 * reference — which is what the author needs to see — rather than a preview that fails to
 * open. Opening a `.brief` from disk gives this a base to resolve against (E9.3).
 */
const noAssets: AssetResolver = {
  // Named, because it is what `E_ASSET_NOT_FOUND` prints as the folder it looked in, and
  // "there is no folder" is a more useful thing for an author to read than a blank.
  base: '(unsaved brief)',
  resolve: () => Promise.resolve(undefined),
};

/** The stages, composed once per service rather than once per keystroke. */
export async function createPreviewService(
  options: PreviewServiceOptions,
): Promise<PreviewService> {
  const { fileSystem } = options;
  const templatesDirectory = options.templatesDirectory ?? builtInTemplates();
  const formatsFile = options.formatsFile ?? fileSystem.join(templatesDirectory, 'formats.yaml');

  // Read once and held, because a preview runs on every keystroke and re-reading every
  // manifest per keystroke would make the editor's latency a function of how many templates
  // are installed. The same argument `loadRenderContext` makes for `tyto watch`.
  const [registry, formats] = await Promise.all([
    loadTemplateRegistry(fileSystem, templatesDirectory),
    loadFormats(fileSystem, formatsFile),
  ]);

  // Startup problems, kept and replayed on every preview rather than thrown. A desktop app
  // whose template folder is unreadable should open, show the editor, and say what is wrong
  // — not refuse to start. `PreviewResult` already has the place to say it.
  const startup: Diagnostic[] = [
    ...(registry.ok ? registry.warnings : registry.error),
    ...(formats.ok ? formats.warnings : formats.error),
  ];

  const catalogue: FormatCatalogue | undefined = formats.ok ? formats.value : undefined;
  const templates: TemplateRegistry | undefined = registry.ok ? registry.value : undefined;

  // One cache for the life of the service: parsing a font to measure a string is the
  // expensive part of `compile`, and the faces do not change between keystrokes.
  const faces = createFaceCache(bundledFontSource);

  const failed = (diagnostics: Diagnostics): PreviewResult => ({
    frames: [],
    diagnostics: [...startup, ...diagnostics],
  });

  return {
    async preview(brief: string): Promise<PreviewResult> {
      if (templates === undefined || catalogue === undefined) return failed([]);

      const ast = parseBrief(brief);
      if (!ast.ok) return failed(ast.error);

      const resolved = await resolve(ast.value, {
        registry: templates,
        assets: noAssets,
      });
      if (!resolved.ok) return failed([...ast.warnings, ...resolved.error]);

      const template = await markupTemplateSource(fileSystem, templates).load(
        resolved.value.template,
      );
      if (!template.ok) {
        return failed([...ast.warnings, ...resolved.warnings, ...template.error]);
      }

      const scene = compile(resolved.value, template.value, { formats: catalogue, faces });
      if (!scene.ok) {
        return failed([
          ...ast.warnings,
          ...resolved.warnings,
          ...template.warnings,
          ...scene.error,
        ]);
      }

      const exported = exportHtml(scene.value, {
        // The bundled faces, embedded in the document. Never a family name the host might
        // not have: determinism is the rule (`docs/architecture.md`), and a preview drawn in
        // a substituted font is a preview of a different artwork.
        resources: { font: bundledFont },
      });

      const before = [
        ...startup,
        ...ast.warnings,
        ...resolved.warnings,
        ...template.warnings,
        ...scene.warnings,
      ];

      if (!exported.ok) return { frames: [], diagnostics: [...before, ...exported.error] };

      return {
        frames: exported.value.map((frame) => ({
          artwork: frame.artwork.id,
          format: frame.frame.format,
          width: frame.frame.size.w,
          height: frame.frame.size.h,
          html: frame.html,
        })),
        diagnostics: [...before, ...exported.warnings],
      };
    },
  };
}
