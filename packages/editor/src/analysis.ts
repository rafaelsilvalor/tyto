import { StateEffect, StateField } from '@codemirror/state';
import {
  type AssetRef,
  type AssetResolver,
  type Diagnostics,
  type TemplateManifest,
  type TemplateRegistry,
  resolve,
} from '@tyto/core';
import { parseBrief } from '@tyto/brief-lang';

/**
 * What the editor knows about the brief in front of it, and who is allowed to work it out.
 *
 * The lint markers and the completion list are two views of one answer: both need the
 * diagnostics `parse` and `resolve` produce, and both need the manifest of the template the
 * frontmatter named. Computing it twice would let the squiggle and the completion list
 * disagree about which template is active, so it is computed once, put in a state field,
 * and read from there by `briefLint` and `briefCompletion`.
 */

/** One pass of `parse` + `resolve` over a document. */
export interface BriefAnalysis {
  /**
   * The document this was computed against.
   *
   * A worker-backed analyzer answers out of order when an author types faster than a
   * round trip, and a response is only usable against the text it read.
   */
  readonly source: string;
  readonly diagnostics: Diagnostics;
  /** The manifest the frontmatter named, when the registry has it. */
  readonly manifest?: TemplateManifest;
  /** Every template name the registry knows, for completing `template:` in the frontmatter. */
  readonly templates: readonly string[];
}

/**
 * The port the lint source asks its questions through.
 *
 * `resolve` needs a `TemplateRegistry` and an `AssetResolver`, and both are answered by a
 * filesystem this package may not touch (ADR 0010) — so the analysis is a port the host
 * fills. `createBriefAnalyzer` is the in-process implementation, which is enough for the
 * demo and for a test; `apps/desktop` hands the same interface a worker-backed one
 * (`createWorkerAnalyzer`) so parsing a twelve-slide brief on every keystroke never lands
 * on the thread that has to paint the caret.
 */
export interface BriefAnalyzer {
  analyze(source: string): Promise<BriefAnalysis>;
}

export interface BriefAnalyzerOptions {
  /**
   * The manifests the editor may check a brief against, already parsed.
   *
   * Manifests and not a `TemplateRegistry`: the registry walks folders through a
   * `FileSystem`, and the renderer has none. The desktop app reads them in main and sends
   * them across the preload bridge, which is also what makes them structured-cloneable
   * enough to reach a worker.
   */
  readonly manifests: readonly TemplateManifest[];
  /**
   * How `::imagem ./foto.png` is checked, when the host can check it.
   *
   * Omitted, every path resolves and **`E_ASSET_NOT_FOUND` never fires in the editor**.
   * That is the honest default rather than a convenient one: a renderer with no disk
   * cannot tell a missing file from a present one, and underlining every image path in a
   * brief that renders perfectly well from the CLI would teach an author to ignore the
   * gutter. The CLI still reports it, and a host that has a bridge to a real filesystem
   * passes a resolver here and gets the diagnostic back.
   */
  readonly assets?: AssetResolver;
}

/**
 * Accepts every path it is given.
 *
 * The `id`/`hash` pair is what a `Scene` would deduplicate assets by, and nothing in the
 * editor builds a scene — the resolved brief is thrown away and only its diagnostics are
 * kept. Using the reference itself keeps two different paths distinguishable anyway, so
 * this never collapses two assets into one behind a caller's back.
 */
const acceptEveryAsset: AssetResolver = {
  base: '',
  resolve: (reference: string): Promise<AssetRef | undefined> =>
    Promise.resolve({
      id: reference,
      source: 'file',
      path: reference,
      hash: `unchecked:${reference}`,
    }),
};

/**
 * A registry over manifests already in memory.
 *
 * `loadTemplateRegistry` in `core` is the folder-walking one and needs a `FileSystem`;
 * this is the same interface answered from a list, which is all `resolve` reads — it calls
 * `get` and `list` and nothing else. `directoryOf` answers `undefined` for every name
 * rather than inventing a path: in the editor there is no folder an asset could be
 * relative to, and a fabricated one would be a lie a future caller could act on.
 */
const registryOf = (manifests: readonly TemplateManifest[]): TemplateRegistry => {
  const byName = new Map<string, TemplateManifest>();
  // Earlier wins, the way a search path does (ADR 0020), so a host that concatenates a
  // project's manifests in front of the built-in pack's gets the precedence it expects.
  for (const manifest of manifests) {
    if (!byName.has(manifest.name)) byName.set(manifest.name, manifest);
  }
  const listed = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    list: () => listed,
    get: (name: string) => byName.get(name),
    formatsOf: (name: string) => byName.get(name)?.formats,
    directoryOf: () => undefined,
    failures: [],
  };
};

/** The `template` the frontmatter names, when it named one as a string. */
const templateNameOf = (data: Readonly<Record<string, unknown>>): string | undefined => {
  const named = data['template'];
  return typeof named === 'string' ? named : undefined;
};

/**
 * Runs the two pure stages the editor can run, in process.
 *
 * `compile` is deliberately not among them. It executes a template, which is a third
 * party's code, and `docs/template-authoring.md` keeps that behind an explicit request for
 * output; an editor that ran it on every keystroke would be running it on a brief the
 * author is halfway through writing. The cost is that `W_TEXT_OVERFLOW` — the one
 * diagnostic only `compile` raises — does not reach the gutter.
 */
export function createBriefAnalyzer(options: BriefAnalyzerOptions): BriefAnalyzer {
  const registry = registryOf(options.manifests);
  const assets = options.assets ?? acceptEveryAsset;
  const templates = registry.list().map((manifest) => manifest.name);

  return {
    analyze: async (source: string): Promise<BriefAnalysis> => {
      const parsed = parseBrief(source);
      if (!parsed.ok) {
        return { source, diagnostics: parsed.error, templates };
      }

      const named = templateNameOf(parsed.value.frontmatter.data);
      const manifest = named === undefined ? undefined : registry.get(named);
      const resolved = await resolve(parsed.value, { registry, assets });

      // Both branches carry diagnostics: `resolve` succeeds with warnings (ADR 0013), and
      // a brief with a `W_UNUSED_SLOT` in it is one the gutter should still mark.
      const diagnostics = resolved.ok
        ? [...parsed.diagnostics, ...resolved.diagnostics]
        : [...parsed.diagnostics, ...resolved.error];

      return {
        source,
        diagnostics,
        templates,
        ...(manifest === undefined ? {} : { manifest }),
      };
    },
  };
}

/** Publishes a finished analysis to the editor state. */
export const setBriefAnalysis = StateEffect.define<BriefAnalysis>();

/**
 * The latest analysis, as the completion source sees it.
 *
 * **The manifest is sticky and the diagnostics are not.** A brief stops parsing the moment
 * an author opens a `**` or types `::` on a fresh line, and that is exactly when the
 * completion list is wanted — dropping the manifest on every unparseable keystroke would
 * make completion blink out whenever it was about to be useful. Diagnostics are the
 * opposite: a stale squiggle points at text that has moved, so each pass replaces the last
 * outright.
 */
export const briefAnalysisField = StateField.define<BriefAnalysis | undefined>({
  create: () => undefined,
  update: (current, transaction) => {
    let next = current;
    for (const effect of transaction.effects) {
      if (!effect.is(setBriefAnalysis)) continue;
      const incoming = effect.value;
      const manifest = incoming.manifest ?? next?.manifest;
      next = { ...incoming, ...(manifest === undefined ? {} : { manifest }) };
    }
    return next;
  },
});
