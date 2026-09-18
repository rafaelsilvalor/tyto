import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type TemplateRegistry } from '@tyto/core';

import { type IpcResponse } from '../../shared/ipc.js';
import { type ProjectSnapshot, type ProjectSources } from './project.js';

/**
 * What a template picker shows, read from the manifests and from nothing else (E9.3).
 *
 * The registry's whole point is answering "what templates are there and what does each one
 * declare" **without executing a line of template code** (`packages/core/src/template/
 * registry.ts`). A picker is exactly the moment that matters: a user browsing a list has not
 * asked for anything to run, and a third party's `template.ts` should not get to run because
 * they scrolled past it. So this reads manifests, and `compile` stays the only thing that
 * executes one.
 *
 * The preview service reads the same folders. This used to read its own registry rather than
 * sharing that one, on a boundary argument: `PreviewService` exposes `preview(brief)` and
 * nothing else, and widening it to hand out its registry would make "compile a brief" and
 * "list what is installed" one object with two reasons to change. That argument still holds
 * and TYTO-122 did not weaken it. What is shared now is `ProjectSources`, which is *neither*
 * service and whose only job is to say which folders are searched: both read it, neither owns
 * the other.
 */

/** The image beside a `manifest.yaml`, by convention; absent from every built-in today. */
const PREVIEW_FILE = 'preview.png';

/** A ceiling, because this is base64 that crosses a process boundary into a `data:` URI. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export interface TemplateCatalogueOptions {
  /** Which folders are searched, and the thing that changes when a person picks one. */
  readonly sources: ProjectSources;
}

export interface TemplateCatalogue {
  /**
   * Everything `templates:list` answers with.
   *
   * A promise since TYTO-122, and `previewUri` is the reason: a folder change means different
   * templates and different `preview.png` files, and those are read from a disk. Memoised on
   * the **identity of the snapshot**, so the promise the doc comment below makes still holds
   * for every call that is not the first after a folder change.
   */
  list(): Promise<IpcResponse<'templates:list'>>;
}

/**
 * A template's `preview.png` as a `data:` URI, or nothing.
 *
 * A path would be the obvious answer and is refused: the renderer's policy is
 * `img-src 'self' data:`, so a `file://` URL never gets fetched. This used to carry a second
 * reason — that the renderer would one day run in a browser tab with no disk under it — and
 * ADR 0024 retired that one. The first reason is a policy in `index.html` and needs no future
 * to justify it. Bytes cross the bridge, the way they do everywhere else here.
 *
 * Every failure is the same answer — no image — because there is nothing a user could do
 * with a message about a file they did not write. A template with no preview is the normal
 * case, not an error to report.
 */
async function previewUri(directory: string): Promise<string | undefined> {
  const bytes = await readFile(join(directory, PREVIEW_FILE)).catch(() => undefined);
  if (bytes === undefined || bytes.length === 0 || bytes.length > MAX_PREVIEW_BYTES) {
    return undefined;
  }
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function entriesOf(registry: TemplateRegistry): IpcResponse<'templates:list'>['templates'] {
  return registry.list().map((manifest) => ({
    name: manifest.name,
    version: manifest.version,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    formats: [...manifest.formats],
  }));
}

/**
 * Reads the folders once and answers from memory until they change.
 *
 * A picker asking per click would be re-reading manifests that cannot have changed — and
 * "cannot have changed" is precisely what TYTO-122 made conditional. So the cache is keyed on
 * the snapshot object rather than on nothing: choosing a folder makes the next call read, and
 * clicking the picker a hundred times still does not.
 */
export async function createTemplateCatalogue(
  options: TemplateCatalogueOptions,
): Promise<TemplateCatalogue> {
  const { sources } = options;

  const build = async (snapshot: ProjectSnapshot): Promise<IpcResponse<'templates:list'>> => {
    // A registry that would not load is an empty picker plus the reason, not a crash. The
    // desktop opens and says it has no templates; that is the same call `plugins.ts` makes.
    const registry = snapshot.registry;

    const templates = registry === undefined ? [] : entriesOf(registry);

    // The preview image is per template and optional, so it is read after the list exists
    // rather than being folded into the map above — a missing file must not cost the entry.
    const withPreviews = await Promise.all(
      templates.map(async (template) => {
        const folder = registry?.directoryOf(template.name);
        const preview = folder === undefined ? undefined : await previewUri(folder);
        return preview === undefined ? template : { ...template, preview };
      }),
    );

    // The registry's own diagnostics, carried across rather than summarised: each one already
    // has a code the docs are indexed by and a message in the user's language. The `range` is
    // dropped because it would index a `manifest.yaml` the editor is not holding, and a panel
    // row that scrolled an unrelated buffer to offset 40 would be worse than one that does not.
    const flatten = (diagnostics: readonly { code: string; message: string; severity: string }[]) =>
      diagnostics.map((problem) => ({
        severity: problem.severity === 'warning' ? ('warning' as const) : ('error' as const),
        code: problem.code,
        message: problem.message,
      }));

    const failures = [
      // Only when the read produced no registry at all. A snapshot that has one already
      // carries its per-folder failures below, and listing both would report one broken
      // template twice.
      ...(registry === undefined
        ? snapshot.roots.map((root) => ({
            directory: root,
            diagnostics: flatten(snapshot.diagnostics),
          }))
        : []),
      ...(registry?.failures ?? []).map((failure) => ({
        directory: failure.directory,
        diagnostics: flatten(failure.diagnostics),
      })),
    ];

    return { templates: withPreviews, failures };
  };

  let cached: { snapshot: ProjectSnapshot; answer: IpcResponse<'templates:list'> } = {
    snapshot: sources.current(),
    answer: await build(sources.current()),
  };

  return {
    list: async () => {
      const snapshot = sources.current();
      if (cached.snapshot === snapshot) return cached.answer;
      cached = { snapshot, answer: await build(snapshot) };
      return cached.answer;
    },
  };
}
