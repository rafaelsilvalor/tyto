import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';

import { parseBrief } from '@tyto/brief-lang';
import {
  type Diagnostic,
  type Diagnostics,
  type FaceCache,
  type TemplateManifest,
  type TemplateRegistry,
  compile,
  createFaceCache,
  parseManifest,
  resolve,
  sceneResources,
} from '@tyto/core';
import { exportHtml } from '@tyto/export-html';
import { bundledFont, bundledFontSource } from '@tyto/fonts';
import { fileAssetResolver, fileResources, fileTemplateAssets } from '@tyto/io';
import { TEMPLATE_FILE, renderedSlotsOf } from '@tyto/pipeline';
import { compileTemplate, isTemplateName, scaffoldTemplate } from '@tyto/template-lang';

import { type PreviewFrame } from './preview.js';
import { type ProjectSources } from './project.js';

/**
 * The desktop's template mode, main's half (TYTO-44): open a template folder, draw what its
 * buffers would draw **before they are saved**, save them, and scaffold a new one.
 *
 * **Markup only, and that is ADR 0007 rather than a gap.** A `template.ts` in a folder is inert
 * everywhere in Tyto — the registry reads manifests, `markupTemplateSource` refuses to import
 * code, and `tools/template-preview` (TYTO-174) is where a code template is previewed, by running
 * `tyto render` on a template compiled into the build. Running code that arrived in a folder is
 * the plugin host's job. So a folder with only a `template.ts` opens as `code`, and the window
 * says it cannot be edited here and why.
 *
 * **The preview compiles the buffers, not the files.** Every keystroke in either tab has to move
 * every format at once, and a preview that read the disk would show the last save. So the
 * manifest text is parsed, the markup compiled against it, and the example brief resolved
 * against a registry holding **only** that manifest — a brief naming another template gets the
 * ordinary `E_UNKNOWN_TEMPLATE`, which is the honest answer to a sample that belongs elsewhere.
 * The template's own files (`assets/…`) are read from its folder, the way `tyto render` reads
 * them, because those are not being edited here.
 *
 * **Saving re-registers by reading the folders again**, through the same `sources.reload` a
 * folder choice uses (TYTO-122): the registry is a snapshot, and a snapshot taken after the write
 * is the only kind that can be right about it. Whether briefs then *use* the template depends on
 * where the folder is — inside the chosen template folder, or not — and the answer says which,
 * because a save that silently changed nothing anybody can render is the "my edit did nothing"
 * question ADR 0020 was written to prevent.
 */

export const MANIFEST_FILE = 'manifest.yaml';
export const CODE_FILE = 'template.ts';
export const EXAMPLES_DIRECTORY = 'examples';

/** Which buffer a diagnostic is about. `render` ranges, when present, index the brief. */
export type TemplateDiagnosticFile = 'manifest' | 'markup' | 'brief' | 'render';

export interface TemplateDiagnostic extends Diagnostic {
  readonly file: TemplateDiagnosticFile;
}

export interface TemplateExample {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

export type OpenedTemplate =
  | {
      readonly kind: 'markup';
      readonly directory: string;
      readonly manifest: string;
      readonly markup: string;
      readonly examples: readonly TemplateExample[];
    }
  /** A folder whose layout is a `template.ts` and has no `template.html` (ADR 0007). */
  | { readonly kind: 'code'; readonly directory: string }
  /** Not a template folder at all: no `manifest.yaml`, or no layout file of either kind. */
  | {
      readonly kind: 'refused';
      readonly directory: string;
      readonly missing: typeof MANIFEST_FILE | typeof TEMPLATE_FILE;
    };

export interface TemplateBuffers {
  readonly directory: string;
  readonly manifest: string;
  readonly markup: string;
}

export interface TemplatePreviewRequest extends TemplateBuffers {
  readonly brief: string;
  /** Where the brief is, so `imagem: assets/foto.png` resolves beside it. */
  readonly briefPath?: string;
}

export interface TemplatePreviewResult {
  /** Every format the manifest declares, for every artwork the brief makes. */
  readonly frames: readonly PreviewFrame[];
  readonly diagnostics: readonly TemplateDiagnostic[];
}

export interface TemplateSaveResult {
  readonly saved: boolean;
  readonly diagnostics: readonly TemplateDiagnostic[];
  /**
   * Whether briefs now render with this folder: it is the one the registry holds under the
   * manifest's name. `false` for a folder outside the chosen template folder, and for a name
   * another template in the same folder already has.
   */
  readonly registered: boolean;
  /** The manifest's name, when it parsed. */
  readonly name?: string;
}

export type ScaffoldResult =
  | { readonly ok: true; readonly directory: string }
  | { readonly ok: false; readonly problem: 'name' | 'exists' | 'write'; readonly detail: string };

export interface TemplateEditorService {
  open(directory: string): Promise<OpenedTemplate>;
  preview(request: TemplatePreviewRequest): Promise<TemplatePreviewResult>;
  save(buffers: TemplateBuffers): Promise<TemplateSaveResult>;
  /** `tyto template new`'s scaffold, into `<parent>/<name>/`, never overwriting. */
  scaffold(parent: string, name: string): Promise<ScaffoldResult>;
}

export interface TemplateEditorOptions {
  readonly sources: ProjectSources;
  /** Injected for the tests; the app's own is the bundled faces. */
  readonly faces?: FaceCache;
}

const tagged = (
  file: TemplateDiagnosticFile,
  diagnostics: Diagnostics,
): readonly TemplateDiagnostic[] => diagnostics.map((item) => ({ ...item, file }));

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Paths compared the way the file system compares them. Windows ignores case, and a folder
 * chosen through a picker and the same folder walked by the registry can differ in nothing
 * else.
 */
const samePath = (left: string, right: string): boolean => {
  const normal = (path: string): string => {
    const absolute = resolvePath(path);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  };
  return normal(left) === normal(right);
};

/**
 * A registry holding one template: the manifest being edited, in the folder being edited.
 *
 * Only that one, and not the project's registry with this entry swapped in: the example is
 * this template's sample, and resolving it against every other template would let a brief
 * that names one of them draw something this mode is not editing.
 */
function registryOf(manifest: TemplateManifest, directory: string): TemplateRegistry {
  return {
    list: () => [manifest],
    get: (name) => (name === manifest.name ? manifest : undefined),
    formatsOf: (name) => (name === manifest.name ? manifest.formats : undefined),
    directoryOf: (name) => (name === manifest.name ? directory : undefined),
    failures: [],
  };
}

async function examplesIn(directory: string): Promise<TemplateExample[]> {
  const folder = join(directory, EXAMPLES_DIRECTORY);
  const names = await readdir(folder).catch(() => [] as string[]);
  const briefs = names.filter((name) => name.endsWith('.brief')).sort();
  const examples = await Promise.all(
    briefs.map(async (name) => {
      const path = join(folder, name);
      const text = await readFile(path, 'utf8').catch(() => undefined);
      return text === undefined ? undefined : { name, path, text };
    }),
  );
  return examples.filter((example) => example !== undefined);
}

export function createTemplateEditor(options: TemplateEditorOptions): TemplateEditorService {
  const { sources } = options;
  // Its own cache, for the preview service's reason: parsing a face to measure a string is the
  // expensive part of `compile`, and the faces are the bundled ones either way.
  const faces = options.faces ?? createFaceCache(bundledFontSource);

  return {
    async open(directory) {
      const manifestPath = join(directory, MANIFEST_FILE);
      const markupPath = join(directory, TEMPLATE_FILE);

      if (!(await exists(manifestPath))) {
        return { kind: 'refused', directory, missing: MANIFEST_FILE };
      }
      if (!(await exists(markupPath))) {
        // A `template.ts` is recognised by name and never read: opening it would be the first
        // step towards running it, and that is the plugin host's (ADR 0007).
        if (await exists(join(directory, CODE_FILE))) return { kind: 'code', directory };
        return { kind: 'refused', directory, missing: TEMPLATE_FILE };
      }

      const [manifest, markup, examples] = await Promise.all([
        readFile(manifestPath, 'utf8'),
        readFile(markupPath, 'utf8'),
        examplesIn(directory),
      ]);
      return { kind: 'markup', directory, manifest, markup, examples };
    },

    async preview({ directory, manifest: manifestText, markup, brief, briefPath }) {
      const manifest = parseManifest(manifestText, join(directory, MANIFEST_FILE));
      // The manifest alone when it does not parse, the way `tyto template check` stops: the
      // markup is checked *against* it, so every complaint after this one would be noise.
      if (!manifest.ok) return { frames: [], diagnostics: tagged('manifest', manifest.error) };

      const own = await fileTemplateAssets({ base: directory });
      const template = compileTemplate(markup, { manifest: manifest.value, assets: own.assets });

      const before: TemplateDiagnostic[] = [
        ...tagged('manifest', manifest.diagnostics),
        ...tagged('markup', template.ok ? template.diagnostics : template.error),
      ];
      if (!template.ok) return { frames: [], diagnostics: before };

      const { formats: catalogue, diagnostics: startup } = sources.current();
      if (catalogue === undefined) {
        return { frames: [], diagnostics: [...before, ...tagged('render', startup)] };
      }

      const ast = parseBrief(brief);
      if (!ast.ok) return { frames: [], diagnostics: [...before, ...tagged('brief', ast.error)] };

      const briefBase = briefPath === undefined ? directory : dirname(briefPath);
      // The slots the markup reads, so a sample that fills one the layout ignores gets
      // `W_UNUSED_SLOT` — the warning an author writing the layout is the one person to act on.
      const rendered = renderedSlotsOf(template.value);
      const resolved = await resolve(ast.value, {
        registry: registryOf(manifest.value, directory),
        assets: fileAssetResolver({ base: briefBase }),
        ...(rendered === undefined ? {} : { renderedSlots: rendered }),
      });
      const briefProblems = [
        ...ast.diagnostics,
        ...(resolved.ok ? resolved.diagnostics : resolved.error),
      ];
      if (!resolved.ok) {
        return { frames: [], diagnostics: [...before, ...tagged('brief', briefProblems)] };
      }

      // **Every format the manifest declares**, whatever the sample's frontmatter asks for. The
      // grid is a view of the template, and a format added to the manifest has to appear in it
      // without somebody also editing a brief they may not have written.
      const scene = compile(
        { ...resolved.value, formats: manifest.value.formats },
        template.value,
        { formats: catalogue, faces },
      );
      const withBrief = [...before, ...tagged('brief', briefProblems)];
      if (!scene.ok)
        return { frames: [], diagnostics: [...withBrief, ...tagged('render', scene.error)] };

      // The brief's pictures from beside the brief, the template's from its own folder — two
      // bases for two kinds of file, which is what `tyto render` does too.
      const images = fileResources({ base: briefBase });
      await images.load(sceneResources(scene.value));
      const briefAsset = images.html?.asset;
      const templateAsset = own.resources.html?.asset;
      const exported = exportHtml(scene.value, {
        resources: {
          font: bundledFont,
          asset: (ref) => briefAsset?.(ref) ?? templateAsset?.(ref),
        },
      });

      const drawn = [...withBrief, ...tagged('render', scene.diagnostics)];
      if (!exported.ok) {
        return { frames: [], diagnostics: [...drawn, ...tagged('render', exported.error)] };
      }

      return {
        frames: exported.value.map((frame) => ({
          artwork: frame.artwork.id,
          format: frame.frame.format,
          width: frame.frame.size.w,
          height: frame.frame.size.h,
          html: frame.html,
        })),
        diagnostics: [...drawn, ...tagged('render', exported.diagnostics)],
      };
    },

    async save({ directory, manifest: manifestText, markup }) {
      // **A manifest that does not parse is never written.** Every brief that names this
      // template is resolved against that file, so writing a broken one would take all of them
      // down on the next reload — and a markup error does not block, because a half-finished
      // layout breaks only the template being written and saving it is how a person keeps it.
      const manifest = parseManifest(manifestText, join(directory, MANIFEST_FILE));
      if (!manifest.ok) {
        return { saved: false, registered: false, diagnostics: tagged('manifest', manifest.error) };
      }

      await writeFile(join(directory, MANIFEST_FILE), manifestText, 'utf8');
      await writeFile(join(directory, TEMPLATE_FILE), markup, 'utf8');

      // Re-registered by reading the folders again, with whatever folder is in force.
      const snapshot = await sources.reload(sources.current().folder?.path);
      const name = manifest.value.name;
      const held = snapshot.registry?.directoryOf(name);
      const registered = held !== undefined && samePath(held, directory);

      // The registry's word on this folder, when it has one — a duplicate name in the same
      // template folder is the failure a save can cause and the manifest cannot see.
      const failures = snapshot.failures
        .filter((failure) => samePath(failure.directory, directory))
        .flatMap((failure) => failure.diagnostics);

      return {
        saved: true,
        registered,
        name,
        diagnostics: [...tagged('manifest', manifest.diagnostics), ...tagged('manifest', failures)],
      };
    },

    async scaffold(parent, name) {
      if (!isTemplateName(name)) return { ok: false, problem: 'name', detail: name };

      const directory = join(parent, name);
      if (await exists(directory)) return { ok: false, problem: 'exists', detail: directory };

      // Every format the project defines, which is the one default the desktop can do better
      // than the CLI's `feed`: the window knows the catalogue, and a new template is most useful
      // drawn at every size it will be asked for.
      const formats =
        sources
          .current()
          .formats?.list()
          .map((format) => format.id) ?? [];
      const scaffold = scaffoldTemplate(name, formats.length === 0 ? ['feed'] : formats);

      try {
        await mkdir(join(directory, EXAMPLES_DIRECTORY), { recursive: true });
        // `wx`, as in the CLI: never overwrite, even in the instant between the check above
        // and this line.
        await writeFile(join(directory, MANIFEST_FILE), scaffold.manifest, { flag: 'wx' });
        await writeFile(join(directory, TEMPLATE_FILE), scaffold.markup, { flag: 'wx' });
        await writeFile(
          join(directory, EXAMPLES_DIRECTORY, `${basename(directory)}.brief`),
          scaffold.example,
          { flag: 'wx' },
        );
      } catch (cause) {
        return {
          ok: false,
          problem: 'write',
          detail: cause instanceof Error ? cause.message : String(cause),
        };
      }

      // A new template is a folder the registry has not read yet.
      await sources.reload(sources.current().folder?.path);
      return { ok: true, directory };
    },
  };
}
