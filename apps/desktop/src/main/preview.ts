import { parseBrief } from '@tyto/brief-lang';
import {
  type AssetResolver,
  type Diagnostics,
  type FileSystem,
  compile,
  resolve,
  sceneResources,
} from '@tyto/core';
import { exportHtml } from '@tyto/export-html';
import {
  bundledTemplateSource,
  fontSubstitutionWarnings,
  markupTemplateSource,
} from '@tyto/pipeline';
import { BUILT_IN_TEMPLATE_BUILDS } from '@tyto/templates';
import { fileAssetResolver, fileResources } from '@tyto/io';

import { faces, fonts } from './fonts.js';
import { type ProjectSources } from './project.js';

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
 * It also makes the preview independent of E5.4, which is decided and not yet built: the
 * capture mechanism is ADR 0027's and the adapter is TYTO-133's.
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

/**
 * One artwork the brief produced, and where in the brief it was written (E9.3).
 *
 * The `range` is the whole reason this list exists beside `frames`. Selecting a slide
 * scrolls the editor to the directive that made it, and a `Scene` carries no source
 * position — by the time a frame exists the brief is three stages behind. `resolve` is the
 * last stage that still knows, so the number is picked up there and carried forward.
 */
export interface PreviewArtwork {
  readonly id: string;
  readonly index: number;
  /** Absent when the template has no repeating slot: one artwork, and no one line for it. */
  readonly range?: { readonly start: number; readonly end: number };
}

export interface PreviewResult {
  readonly frames: readonly PreviewFrame[];
  readonly artworks: readonly PreviewArtwork[];
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
  /**
   * Which folders are searched, read **per compile** rather than held (TYTO-122).
   *
   * It used to be two paths resolved at construction, which quietly made the template folder
   * a property of the service's lifetime. `src/main/project.ts` says why one holder read per
   * call is cheaper and safer than rebuilding this service when a person picks a folder.
   */
  readonly sources: ProjectSources;
}

export interface PreviewService {
  /**
   * The frames `brief` produces right now, and what was wrong with it. Never rejects.
   *
   * `baseDirectory` is the folder that brief lives in, and it is an argument rather than
   * something the service holds (E9.11). It used to be a getter passed at construction,
   * which quietly assumed there was one open document to ask about; with tabs there are
   * several, and the only side that knows which one a given compile is for is the caller
   * that was handed the request's `documentId`.
   */
  preview(brief: string, baseDirectory?: string): Promise<PreviewResult>;
}

/**
 * A resolver that finds nothing, which is the honest answer until a brief has a folder.
 *
 * The preview compiles text, not a file on disk, so until something is opened there is no
 * `assets/` beside it to read. A brief that references an asset gets the exporter's own
 * diagnostic naming the missing reference — which is what the author needs to see — rather
 * than a preview that fails to open. Opening a `.brief` replaces this with a real resolver
 * rooted at the file's own folder (E9.8), and the images start appearing.
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
  const { fileSystem, sources } = options;

  // `faces` is one cache for the life of the process (`fonts.ts`): parsing a font to
  // measure a string is the expensive part of `compile`, and neither the bundled faces nor
  // the installed ones are a function of which template folder is in force.

  return {
    async preview(brief: string, baseDirectory?: string): Promise<PreviewResult> {
      // Read once per compile, not per frame, and not at construction (TYTO-122). Per
      // compile is what lets a folder chosen at 11am be searched at 11:01 with no restart;
      // once, so a reload landing mid-compile cannot change the registry under it.
      const {
        registry: templates,
        formats: catalogue,
        // Startup problems, replayed on every preview rather than thrown. A desktop app whose
        // template folder is unreadable should open, show the editor, and say what is wrong.
        diagnostics: startup,
      } = sources.current();

      const failed = (diagnostics: Diagnostics): PreviewResult => ({
        frames: [],
        artworks: [],
        diagnostics: [...startup, ...diagnostics],
      });

      if (templates === undefined || catalogue === undefined) return failed([]);

      const ast = parseBrief(brief);
      if (!ast.ok) return failed(ast.error);

      // Built per preview, because the folder is a property of what is open rather than of
      // the service. `confine` stays on, its default: a brief is often written by something
      // else (ADR 0011), and `../../../.ssh/id_rsa` embedded in an exported PNG is a real
      // way to leak a file. An author previewing their own folder is inside it anyway.
      const assets =
        baseDirectory === undefined ? noAssets : fileAssetResolver({ base: baseDirectory });

      const resolved = await resolve(ast.value, {
        registry: templates,
        assets,
      });
      if (!resolved.ok) return failed([...ast.diagnostics, ...resolved.error]);

      // The same pairing the export path uses: a preview that could not draw a code
      // template would send somebody to the CLI to find out whether their work rendered.
      const template = await bundledTemplateSource({
        registry: templates,
        fileSystem,
        bundled: BUILT_IN_TEMPLATE_BUILDS,
        markup: markupTemplateSource(fileSystem, templates),
      }).load(resolved.value.template);
      if (!template.ok) {
        return failed([...ast.diagnostics, ...resolved.diagnostics, ...template.error]);
      }

      const scene = compile(resolved.value, template.value, { formats: catalogue, faces });
      if (!scene.ok) {
        return failed([
          ...ast.diagnostics,
          ...resolved.diagnostics,
          ...template.diagnostics,
          ...scene.error,
        ]);
      }

      // The bytes for the images the scene draws, read between `compile` and the export.
      // That window is the whole of it (`docs/architecture.md`): an exporter's `asset`
      // lookup is synchronous because a `SceneVisitor` cannot await, so the bytes must be
      // in memory before the first walk — and *which* bytes is a question only a `Scene`
      // answers.
      //
      // Finding the file and reading it are two different ports and both are needed. The
      // `AssetResolver` above tells `resolve` that `assets/logo.png` exists; without this
      // the exporter would still have nothing to embed and would report
      // `E_EXPORT_ASSET_UNRESOLVED` naming an asset that is right there on the disk. Found
      // by opening a file and looking at the preview, not by a unit test.
      const images =
        baseDirectory === undefined ? undefined : fileResources({ base: baseDirectory });
      const needed = sceneResources(scene.value);
      if (images !== undefined) await images.load(needed);

      const exported = exportHtml(scene.value, {
        // The faces embedded in the document, never a family name left for the host to
        // find. A `system` face this machine lacks is embedded as its bundled substitute and
        // reported below (ADR 0037), so the preview is the export and says where it differs.
        resources: { font: fonts.font, ...(images?.html ?? {}) },
      });

      const before = [
        ...startup,
        ...ast.diagnostics,
        ...resolved.diagnostics,
        ...template.diagnostics,
        ...scene.diagnostics,
        ...fontSubstitutionWarnings(fonts.substitutions(needed.faces)),
      ];

      // Zipped by position, which is exact rather than close enough: `planArtworks` maps
      // `resolved.artworks` one to one and in order, and `compile` pushes one `Artwork` per
      // plan. A brief whose template has no repeating slot has one plan and no resolved
      // artwork, so the lookup misses and the range is absent — which is the right answer,
      // not a gap. Matching on the id instead would mean rebuilding `${slot}-${n + 1}` here,
      // a second copy of a name `compile` owns.
      const artworks: PreviewArtwork[] = scene.value.artworks.map((artwork, index) => {
        const source = resolved.value.artworks[index]?.slot.range;
        return { id: artwork.id, index, ...(source === undefined ? {} : { range: source }) };
      });

      if (!exported.ok) {
        return { frames: [], artworks, diagnostics: [...before, ...exported.error] };
      }

      return {
        frames: exported.value.map((frame) => ({
          artwork: frame.artwork.id,
          format: frame.frame.format,
          width: frame.frame.size.w,
          height: frame.frame.size.h,
          html: frame.html,
        })),
        artworks,
        diagnostics: [...before, ...exported.diagnostics],
      };
    },
  };
}
