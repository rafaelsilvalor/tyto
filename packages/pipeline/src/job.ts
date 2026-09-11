import {
  type Artwork,
  type AssetResolver,
  type BriefAst,
  type Diagnostic,
  type Diagnostics,
  type FormatCatalogue,
  type Frame,
  type Result,
  type Scene,
  type Template,
  type TemplateRegistry,
  compile,
  diagnostic,
  err,
  fromDiagnostics,
  isError,
  ok,
  resolve,
} from '@tyto/core';
import { parseBrief } from '@tyto/brief-lang';
import type { Exporter, ExporterRegistry } from '@tyto/plugin-api';
import type { Rasterizer } from '@tyto/raster';

import {
  type Artifact,
  type ArtifactKind,
  type ArtifactSink,
  artifactMimeType,
  artifactName,
} from './artifact.js';
import { type FrameTarget, type JobListener, notify } from './events.js';
import { limiter } from './limit.js';
import { type TemplateSource, renderedSlotsOf } from './template-source.js';

/**
 * The job: a brief in, artifacts out (`docs/architecture.md`).
 *
 * It composes the stages and owns nothing else. Every stage is somebody else's pure
 * function and every capability is a port the caller supplies, which is the whole reason
 * the same job can run in the desktop app, in the CLI and later in a cloud worker without
 * a line of it changing (ADR 0010). What the job adds is the four things no single stage
 * can decide alone: what order they run in, what the files are called, how much rastering
 * happens at once, and what to do when one frame of twelve is broken.
 *
 * ## Every frame is attempted
 *
 * `exportHtml` and `exportSvg` take a whole scene and fail as a whole, so the job does not
 * use them — it walks the frames itself and calls `exportFrameHtml` / `exportFrameSvg` one
 * at a time. An author with a bad gradient on the story frame should not have to fix it,
 * re-run, and only then discover the second problem on the feed frame. Twelve frames
 * produce twelve verdicts, and they are reported together.
 *
 * ## Cancellation
 *
 * An `AbortSignal`, checked before every stage and before every write. A frame already in
 * flight when the signal fires is allowed to finish computing — killing a Chromium context
 * mid-capture buys nothing — but its bytes are **not** handed to the sink. So a cancelled
 * job adds no file to the output that was not already complete, which is the acceptance
 * criterion; that no individual file is ever half-written is the sink's promise, and the
 * reason the job does not open files itself.
 */

/**
 * One requested encoding of every frame.
 *
 * One shape rather than a union per kind. It was a union — `svg` with `textAsPaths`, the
 * raster formats with `quality` and `scale` — and that made the *type* say which options
 * belong to which exporter, which is exactly the knowledge an extension point takes away
 * from the job (ADR 0007). An exporter reads the options it understands and ignores the
 * rest; the rasterizer port still refuses `quality` on a PNG at the one place that can
 * actually check it.
 */
export interface OutputRequest {
  readonly kind: ArtifactKind;
  /** 1–100, and only for `jpeg` and `webp`; the raster port refuses it on `png`. */
  readonly quality?: number;
  /** Device pixels per CSS pixel. `2` is the retina export. */
  readonly scale?: number;
  /** `svg` only: draw text as outlines. An exporter that does not know it ignores it. */
  readonly textAsPaths?: boolean;
}

export interface JobRequest {
  /** The brief's text. Parsing it is the job's first stage. */
  readonly brief: string;
  /**
   * `--template`, used only when the brief's frontmatter names none.
   *
   * The precedence is `resolve`'s, mirrored here because the job has to know the name
   * before `resolve` runs in order to load the template at all.
   */
  readonly template?: string;
  /**
   * `--formats`, used only when the brief's frontmatter lists none.
   *
   * Passed straight to `resolve`, which owns the precedence and the `E_UNKNOWN_FORMAT` it
   * writes for a format the template does not render. The job does not filter frames
   * itself: a frame the caller did not ask for should never be built, and building one to
   * drop it afterwards would run the template for nothing.
   */
  readonly formats?: readonly string[];
  /** At least one. An empty list is a caller that has not decided what it wants. */
  readonly outputs: readonly OutputRequest[];
  readonly signal?: AbortSignal;
}

export interface JobPorts {
  readonly registry: TemplateRegistry;
  readonly templates: TemplateSource;
  readonly assets: AssetResolver;
  readonly formats: FormatCatalogue;
  /**
   * Which exporter produces which output kind (ADR 0007).
   *
   * A port, like every other capability here. The job used to import `exportFrameHtml` and
   * `exportFrameSvg` and branch on `kind === 'svg'`, which made two of the nine extension
   * points built in rather than contributed — and left a third-party exporter with nothing
   * to plug into. The bytes each exporter needs for a font or an image are bound when it is
   * registered, so this stage no longer carries resources it never reads.
   */
  readonly exporters: ExporterRegistry;
  /** Required as soon as one requested kind comes from a `rasterized` exporter. */
  readonly rasterizer?: Rasterizer;
  /** Absent means the artifacts come back in memory and nothing is written. */
  readonly sink?: ArtifactSink;
  /** Frames rastered at once. Defaults to 2 — see `limit.ts` for why not more. */
  readonly concurrency?: number;
  readonly onEvent?: JobListener;
}

export interface JobReport {
  /** In scene order: artwork, then format, then the order `outputs` was written. */
  readonly artifacts: readonly Artifact[];
  /** True when the signal fired before the last frame was written. */
  readonly cancelled: boolean;
  /** Frames × outputs, known once `compile` has produced a scene. */
  readonly planned: number;
  readonly rendered: number;
  readonly failed: number;
}

const DEFAULT_CONCURRENCY = 2;

/** `resolve`'s rule, duplicated because the job needs the answer before `resolve` runs. */
function templateNameOf(ast: BriefAst, override: string | undefined): string | undefined {
  const named = ast.frontmatter.data.template;
  return typeof named === 'string' && named.trim() !== '' ? named.trim() : override;
}

function renderFailure(target: FrameTarget, problem: string): Diagnostic {
  return diagnostic('E_RENDER_FAILED', {
    frame: `${target.artwork}:${target.format}`,
    kind: target.kind,
    problem,
  });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Every frame of every artwork, once per requested output, in a deterministic order. */
interface Task {
  readonly artwork: Artwork;
  readonly frame: Frame;
  readonly output: OutputRequest;
  readonly target: FrameTarget;
}

function plan(scene: Scene, outputs: readonly OutputRequest[]): readonly Task[] {
  const tasks: Task[] = [];
  for (const artwork of scene.artworks) {
    for (const frame of artwork.frames) {
      for (const output of outputs) {
        tasks.push({
          artwork,
          frame,
          output,
          target: { artwork: artwork.id, format: frame.format, kind: output.kind },
        });
      }
    }
  }
  return tasks;
}

export async function runJob(
  request: JobRequest,
  ports: JobPorts,
): Promise<Result<JobReport, Diagnostics>> {
  if (request.outputs.length === 0) {
    throw new TypeError(
      'A job needs at least one output. Rendering nothing successfully is not a result a ' +
        'caller can act on.',
    );
  }

  // Resolved before anything runs, so a missing exporter is one sentence at the top rather
  // than the same failure repeated once per frame.
  const exporterFor = new Map<string, Exporter>();
  for (const output of request.outputs) {
    const exporter = ports.exporters.forKind(output.kind);
    if (exporter === undefined) {
      throw new TypeError(
        `No registered exporter produces '${output.kind}'. Registered: ` +
          `${ports.exporters
            .list()
            .map((item) => `${item.id} (${item.kinds.join(', ')})`)
            .join('; ')} — see docs/plugin-api.md.`,
      );
    }
    exporterFor.set(output.kind, exporter);
  }

  const rastering = [...exporterFor.values()].some((exporter) => exporter.rasterized);
  if (rastering && ports.rasterizer === undefined) {
    const kinds = [...exporterFor]
      .filter(([, exporter]) => exporter.rasterized)
      .map(([kind]) => kind)
      .join(', ');
    throw new TypeError(
      `Outputs ${kinds} come from an exporter whose document has to be rastered, and no ` +
        'rasterizer was supplied. Pass ports.rasterizer, or ask only for kinds a ' +
        'non-rasterized exporter produces.',
    );
  }

  const { onEvent } = ports;
  const { signal } = request;

  /**
   * Read through a call, never as `signal?.aborted`.
   *
   * The property changes under the job — that is what a signal is — and TypeScript
   * narrows a property access after the first check and keeps the narrowing across an
   * `await`, so a second check written that way compiles to a comparison it believes can
   * never be true. A function call is opaque to that narrowing, which is the
   * correct model here rather than a workaround for it.
   */
  const aborted = (): boolean => signal?.aborted === true;
  const problems: Diagnostic[] = [];
  const empty = (cancelled: boolean): JobReport => ({
    artifacts: [],
    cancelled,
    planned: 0,
    rendered: 0,
    failed: 0,
  });

  /* ------------------------------------------------------------------------ parse -- */

  notify(onEvent, { kind: 'stage-started', stage: 'parse' });
  const parsed = parseBrief(request.brief);
  if (!parsed.ok) return err(parsed.error);
  problems.push(...parsed.warnings);
  notify(onEvent, { kind: 'stage-finished', stage: 'parse' });

  if (aborted()) {
    notify(onEvent, { kind: 'cancelled', done: 0, total: 0 });
    return ok(empty(true), problems);
  }

  /* --------------------------------------------------------------------- template -- */

  // Before `resolve`, so the markup's `renderedSlots` can reach it and a brief that fills
  // a slot this template never draws gets W_UNUSED_SLOT. A name that is missing or unknown
  // is left for `resolve` to report: it owns E_NO_TEMPLATE and E_UNKNOWN_TEMPLATE, with
  // the frontmatter range and the "did you mean" the job has no business rewriting.
  notify(onEvent, { kind: 'stage-started', stage: 'template' });
  const name = templateNameOf(parsed.value, request.template);
  let template: Template | undefined;

  if (name !== undefined && ports.registry.get(name) !== undefined) {
    const loaded = await ports.templates.load(name);
    if (!loaded.ok) return err([...problems, ...loaded.error]);
    template = loaded.value;
    problems.push(...loaded.warnings);
  }
  notify(onEvent, { kind: 'stage-finished', stage: 'template' });

  /* ---------------------------------------------------------------------- resolve -- */

  notify(onEvent, { kind: 'stage-started', stage: 'resolve' });
  const renderedSlots = template === undefined ? undefined : renderedSlotsOf(template);

  const resolved = await resolve(parsed.value, {
    registry: ports.registry,
    assets: ports.assets,
    ...(request.template === undefined ? {} : { template: request.template }),
    ...(request.formats === undefined ? {} : { formats: request.formats }),
    ...(renderedSlots === undefined ? {} : { renderedSlots }),
  });
  if (!resolved.ok) return err([...problems, ...resolved.error]);
  problems.push(...resolved.warnings);
  notify(onEvent, { kind: 'stage-finished', stage: 'resolve' });

  // Unreachable in practice: `resolve` succeeded, so it found a manifest for the same name
  // in the same registry the load above consulted. Kept as a value rather than an
  // assertion, because a `TemplateSource` that disagrees with its registry is a wiring bug
  // the caller should read about, not a crash inside the job.
  if (template === undefined) {
    return err([
      ...problems,
      diagnostic('E_UNKNOWN_TEMPLATE', {
        template: resolved.value.template,
        available: ports.registry
          .list()
          .map((entry) => entry.name)
          .join(', '),
      }),
    ]);
  }

  if (aborted()) {
    notify(onEvent, { kind: 'cancelled', done: 0, total: 0 });
    return ok(empty(true), problems);
  }

  /* ---------------------------------------------------------------------- compile -- */

  notify(onEvent, { kind: 'stage-started', stage: 'compile' });
  const compiled = compile(resolved.value, template, { formats: ports.formats });
  if (!compiled.ok) return err([...problems, ...compiled.error]);
  problems.push(...compiled.warnings);
  notify(onEvent, { kind: 'stage-finished', stage: 'compile' });

  /* ----------------------------------------------------------------------- render -- */

  const tasks = plan(compiled.value, request.outputs);
  const total = tasks.length;
  notify(onEvent, { kind: 'planned', total });
  notify(onEvent, { kind: 'stage-started', stage: 'render' });

  const scene = compiled.value;
  const gate = limiter(ports.concurrency ?? DEFAULT_CONCURRENCY);
  const artifacts: (Artifact | undefined)[] = Array.from({ length: total });
  const failures: Diagnostic[][] = Array.from({ length: total }, () => []);
  let done = 0;
  let failed = 0;
  let cancelled = false;

  /** Defined for every requested kind: the loop above refused the job otherwise. */
  function exporterOf(task: Task): Exporter {
    const exporter = exporterFor.get(task.output.kind);
    if (exporter === undefined) {
      throw new TypeError(`No exporter for '${task.output.kind}', which was checked earlier.`);
    }
    return exporter;
  }

  function bytesOf(task: Task): Result<string, Diagnostics> {
    // An exporter that does not understand `textAsPaths` ignores it, which is why this is
    // the same call for every kind. The resources were bound when it was registered.
    return exporterOf(task).exportFrame(scene, task.artwork, task.frame, {
      ...(task.output.textAsPaths === undefined ? {} : { textAsPaths: task.output.textAsPaths }),
    });
  }

  async function encode(task: Task, document: string): Promise<Result<Uint8Array, Diagnostics>> {
    // The exporter says whether its document is already the artifact. The job used to ask
    // `kind === 'svg'`, which is the same question with the answer hardcoded.
    if (!exporterOf(task).rasterized) return ok(new TextEncoder().encode(document));

    // The `Rasterizer` port takes positive integers and refuses to guess at a rounding
    // (`resolveRasterOptions`), so the job — the caller — decides here. A frame that
    // rounds to nothing is a template that produced no canvas, and that is a diagnostic
    // about the render rather than a `TypeError` out of the port.
    const width = Math.round(task.frame.size.w);
    const height = Math.round(task.frame.size.h);
    if (width < 1 || height < 1) {
      return err([
        renderFailure(
          task.target,
          `the frame measures ${String(task.frame.size.w)}×${String(task.frame.size.h)}, ` +
            'which is no pixels at all',
        ),
      ]);
    }

    try {
      // Defined: the guard at the top of `runJob` refused a raster output without one.
      const format = task.output.kind === 'svg' ? undefined : task.output.kind;
      const bytes = await ports.rasterizer?.raster(document, {
        width,
        height,
        // Absent only for `svg`, which never reaches here: an exporter that produces it
        // is not `rasterized`. Narrowed rather than cast, so the impossible case stays
        // impossible to the compiler too.
        ...(format === undefined ? {} : { format }),
        ...(task.output.quality === undefined ? {} : { quality: task.output.quality }),
        ...(task.output.scale === undefined ? {} : { scale: task.output.scale }),
      });
      return bytes === undefined
        ? err([renderFailure(task.target, 'no rasterizer was supplied')])
        : ok(bytes);
    } catch (cause) {
      // A browser that will not launch, a capture that timed out. One broken frame is not
      // a reason to abandon the other eleven, so it becomes data here.
      return err([renderFailure(task.target, messageOf(cause))]);
    }
  }

  async function run(task: Task, index: number): Promise<void> {
    if (aborted()) {
      cancelled = true;
      return;
    }

    notify(onEvent, { kind: 'frame-started', target: task.target });

    const document = bytesOf(task);
    const encoded = document.ok ? await encode(task, document.value) : err(document.error);
    const warnings = document.ok ? document.warnings : [];

    if (!encoded.ok) {
      const collected = [...warnings, ...encoded.error];
      failures[index] = collected;
      done += 1;
      failed += 1;
      notify(onEvent, {
        kind: 'frame-failed',
        target: task.target,
        problems: collected,
        done,
        total,
      });
      return;
    }

    const artifact: Artifact = {
      name: artifactName(task.artwork.id, task.frame.format, task.output.kind),
      artwork: task.artwork.id,
      format: task.frame.format,
      kind: task.output.kind,
      mime: artifactMimeType(task.output.kind),
      bytes: encoded.value,
    };

    // Checked again, after the work: the bytes exist but the user asked to stop, and
    // putting one more file in the output folder is exactly what they asked not to happen.
    if (aborted()) {
      cancelled = true;
      return;
    }

    try {
      await ports.sink?.write(artifact);
    } catch (cause) {
      const collected = [
        ...warnings,
        diagnostic('E_OUTPUT_WRITE', { artifact: artifact.name, problem: messageOf(cause) }),
      ];
      failures[index] = collected;
      done += 1;
      failed += 1;
      notify(onEvent, {
        kind: 'frame-failed',
        target: task.target,
        problems: collected,
        done,
        total,
      });
      return;
    }

    failures[index] = [...warnings];
    artifacts[index] = artifact;
    done += 1;
    notify(onEvent, {
      kind: 'frame-finished',
      target: task.target,
      artifact: artifact.name,
      done,
      total,
    });
  }

  await Promise.all(tasks.map(async (task, index) => gate.run(async () => run(task, index))));

  notify(onEvent, { kind: 'stage-finished', stage: 'render' });
  if (cancelled) notify(onEvent, { kind: 'cancelled', done, total });

  // Indexed rather than pushed, so the report lists artifacts in scene order however the
  // limiter interleaved the work. A job whose file list depended on which frame finished
  // first would be a job whose `result.json` changed between two identical runs.
  for (const collected of failures) problems.push(...collected);

  const report: JobReport = {
    artifacts: artifacts.filter((artifact): artifact is Artifact => artifact !== undefined),
    cancelled,
    planned: total,
    rendered: artifacts.reduce(
      (count, artifact) => (artifact === undefined ? count : count + 1),
      0,
    ),
    failed,
  };

  // ADR 0013: warnings ride the success branch, an error replaces the value. A frame that
  // failed makes the job an `Err` carrying every diagnostic — which is what `tyto render`
  // turns into a non-zero exit (ADR 0011) — and the artifacts that did render have already
  // reached the sink, so a caller that wants partial output supplies one.
  return problems.some(isError) ? err(problems) : fromDiagnostics(report, problems);
}
