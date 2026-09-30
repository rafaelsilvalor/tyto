import type {
  Artwork,
  Diagnostics,
  Directive,
  ExpansionResult,
  Frame,
  Result,
  Scene,
  TemplateAnswer,
  TemplateCall,
  TemplateContext,
  TemplateManifest,
} from '@tyto/core';

import type { ShippedFace } from './isolation/faces.js';

/**
 * The nine extension points of `docs/plugin-api.md`, as types.
 *
 * Every one of them is a thing a plugin contributes and the host hands back; built-ins use
 * the same shapes, because a built-in that had a shortcut would be a shortcut nobody could
 * discover was missing from the public API (ADR 0007).
 *
 * ## Why some are generic
 *
 * A few ports are declared by the package that consumes them and that package is a Node
 * one — `BriefSource` and `OutputSink` in `@tyto/io`, `Rasterizer` in `@tyto/raster`. This
 * package is pure (ADR 0010) and cannot name a type that drags Node's types in with it, and
 * re-declaring those shapes here would be two declarations of one contract waiting to
 * drift. So the contribution is generic in the thing contributed: the composition root
 * writes `registerSource({ id, source: fsInbox(...) })` and reads it back with the same
 * type, and the host in between only ever needs the id.
 */

/** What every contribution has: a name that is unique among its own kind. */
export interface Contribution {
  /**
   * Unique within one extension point.
   *
   * Two exporters called `svg` is a question with no right answer — which one runs? — so
   * the host refuses the second rather than picking (`E_PLUGIN_DUPLICATE`).
   */
  readonly id: string;
}

/* ------------------------------------------------------------------------- exporter -- */

export interface ExportFrameOptions {
  /**
   * Draw text as outlines rather than as text runs. `svg` only; an exporter that does not
   * understand it ignores it.
   */
  readonly textAsPaths?: boolean;
}

/**
 * One frame of one artwork, as a document.
 *
 * **Per frame, not per scene.** `docs/plugin-api.md` used to say an exporter contributes a
 * `SceneVisitor<string>`, and that is not a thing a job can call: a visitor is per node,
 * and a whole-scene export fails as a whole — twelve frames would produce one verdict
 * where an author needs twelve. `runJob` walks the frames itself for exactly that reason,
 * so the extension point is the function it actually calls (TYTO-34).
 *
 * **Resources are bound at registration, not passed here.** The bytes an exporter needs
 * for a font or an image have a different shape per exporter today — `HtmlResources.font`
 * takes an `HtmlFontFace` where `SvgResources.font` takes an `SvgFontFace` — and
 * reconciling those is TYTO-62's subject. Closing over them at registration keeps this
 * contract out of that argument entirely.
 */
export interface Exporter extends Contribution {
  /** For `result.json` and the file name, when this exporter's document *is* the artifact. */
  readonly mime: string;
  readonly extension: string;
  /**
   * The artifact kinds a caller can ask for and get through this exporter.
   *
   * `svg` produces `svg`. `html` produces `png`, `jpeg` and `webp` — but only by way of a
   * rasterizer, which is what {@link rasterized} says.
   */
  readonly kinds: readonly string[];
  /**
   * The document still has to go through a `Rasterizer` to become bytes.
   *
   * The one thing a job has to know that the document itself does not say. Without it the
   * job would be back to branching on `kind === 'svg'`, which is the branch this extension
   * point exists to remove.
   */
  readonly rasterized: boolean;
  /**
   * Synchronous or not, as the exporter pleases (ADR 0041).
   *
   * The built-ins answer on the spot. An exporter registered by an isolated plugin is a
   * proxy whose answer comes back across a thread or a process, and no such answer can be
   * synchronous; the job awaits either.
   */
  exportFrame(
    scene: Scene,
    artwork: Artwork,
    frame: Frame,
    options?: ExportFrameOptions,
  ): Result<string, Diagnostics> | Promise<Result<string, Diagnostics>>;
}

/**
 * The read side of the exporter extension point, as a job asks it.
 *
 * A job never enumerates exporters; it has an output kind and needs the one that produces
 * it. Declared here rather than in `@tyto/pipeline` because it is the extension point's
 * own contract, and a second declaration would let the two drift.
 */
export interface ExporterRegistry {
  /** The exporter whose `kinds` contain this one, or nothing. */
  forKind(kind: string): Exporter | undefined;
  /** In registration order — for a `--help` listing and for the desktop's format picker. */
  list(): readonly Exporter[];
}

/* --------------------------------------------------------------- the generic points -- */

/**
 * A contribution whose type lives in a package this one may not import.
 *
 * `Rasterizer` is in `@tyto/raster`, `BriefSource` and `OutputSink` are in `@tyto/io`, and
 * both are Node packages. The host stores the value and hands it back unchanged; only the
 * two ends need to agree on what it is, and they are the same composition root.
 */
export interface Provided<T> extends Contribution {
  readonly value: T;
}

/** `source` — a queue a brief arrives from. `BriefSource` in `@tyto/io` is the built-in. */
export type SourceContribution<T> = Provided<T>;

/** `sink` — where a task's output goes. `OutputSink` in `@tyto/io` is the built-in. */
export type SinkContribution<T> = Provided<T>;

/** `rasterizer` — HTML to image bytes. `createPlaywrightRasterizer` is the built-in. */
export type RasterizerContribution<T> = Provided<T>;

/* -------------------------------------------------------------------- template-pack -- */

/**
 * A folder of templates, as manifests the registry already read.
 *
 * Manifests rather than a path, because a pack may be bundled in a package rather than on
 * a disk, and because `TemplateRegistry` never executes what it lists (ADR 0007) — reading
 * a manifest is the whole of what a pack contributes at this point.
 */
export interface TemplatePack extends Contribution {
  readonly templates: readonly TemplateManifest[];
  /** Where the folder is, when it is on a disk — what an asset path inside it is relative to. */
  readonly directory?: string;
  /**
   * The code templates of the pack, by manifest name: a folder with a `manifest.yaml` and
   * no `template.html` is built by this (ADR 0048). The plugin bundles the code into its
   * `dist/`; nothing is imported from the folder.
   *
   * Only an installed plugin's pack is built this way, and only in the plugin's own
   * process: the host holds a proxy, which it calls with a {@link TemplateCall} and the
   * faces that cross with it ({@link IsolatedPackBuild}), and the plugin's function is
   * handed a real context whose `measure` answers from those faces.
   */
  readonly build?: (template: string, context: TemplateContext) => Frame | Promise<Frame>;
}

/**
 * `TemplatePack.build` as the host's proxy of it is called (ADR 0048): the context crosses
 * without `measure` and `report`, the faces it measures cross beside it, and the answer is a
 * result, because a timeout, a crash and a frame the IR schema refuses arrive as values.
 * What succeeds is the frame and the reports the template made building it (ADR 0058),
 * which the host hands to its own `report`.
 */
export type IsolatedPackBuild = (
  template: string,
  call: TemplateCall,
  faces: readonly ShippedFace[],
) => Promise<Result<TemplateAnswer, Diagnostics>>;

/* ------------------------------------------------------------------------ directive -- */

/**
 * `directive` — the `::namespace/name` directives of one namespace (E11.3, ADR 0043).
 *
 * **`id` is the namespace.** `::demo/shout` routes to the contribution whose id is
 * `demo`, and two plugins claiming one namespace is `E_PLUGIN_DUPLICATE` through the same
 * check every other point uses. A separate `namespace` field would be a second name for
 * the one thing the host keys on.
 *
 * **`transform` answers with slot directives, never with a `ResolvedBrief`.** It is
 * handed the directive as parsed — its name, its adjustments and its body, each with its
 * range — and returns ordinary `::slot` directives that `resolve` checks against the
 * manifest like typed ones. The adjustments are the plugin's own arguments and are not
 * checked against the manifest; they do not reach the replacement unless the plugin puts
 * them there.
 */
export interface DirectiveContribution extends Contribution {
  /** What `::<id>/` offers — the names autocomplete lists, and the only ones that resolve. */
  readonly names: readonly string[];
  /** Synchronous or not: an isolated plugin's answer crosses a thread (ADR 0041). */
  transform(directive: Directive): ExpansionResult | Promise<ExpansionResult>;
}

/* --------------------------------------------------------------------------- editor -- */

/** `editor.command` — one entry of the Command pattern, with its undo (E8.3). */
export interface EditorCommand extends Contribution {
  readonly title: string;
}

/** `editor.keymap` — a binding to a command id, in normal mode or in vim (E8.3). */
export interface EditorKeymap extends Contribution {
  readonly bindings: Readonly<Record<string, string>>;
  readonly mode?: 'normal' | 'vim';
}

/**
 * `panel` — a page in the desktop's window, sandboxed in an iframe (E11.3, ADR 0045).
 *
 * Data only: the page is a file the plugin ships, and the host serves it from the plugin's
 * folder into an iframe with `sandbox="allow-scripts"` and nothing else. What it can ask of
 * the host goes through a `postMessage` bridge, checked against the same permissions as the
 * plugin's own `host.fetch` and `host.credentials` (ADR 0042).
 */
export interface PanelContribution extends Contribution {
  readonly title: string;
  /** Where the panel docks. The renderer decides what it does with an unknown one. */
  readonly location?: 'left' | 'right' | 'bottom';
  /**
   * The page, as a path inside the plugin's folder with `/` between segments —
   * `panel/index.html`. A path that leaves the folder is never served.
   */
  readonly entry: string;
}
