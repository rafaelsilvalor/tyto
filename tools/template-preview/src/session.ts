import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type PreviewDiagnostic,
  type RebuildOutcome,
  type RenderOutcome,
  type RenderRequest,
  rebuildTemplates,
  renderWithTyto,
} from './tyto.ts';

/**
 * One template being watched: what was last drawn, and the queue of redraws.
 *
 * **A generation is one render, and the page only ever shows the newest finished one.**
 * Each writes into its own folder, and the one before it is deleted once it is replaced,
 * so an image from before a failure cannot be served after it — not by the page, which
 * reads its list from the state, and not by a stale URL, which then answers 404.
 */

export interface PreviewTarget {
  readonly template: string;
  readonly brief: string;
  readonly templates: string;
  readonly formatsFile: string;
  readonly types: readonly string[];
  /** True when a saved `.ts` has to be rebuilt into `@tyto/templates` before a render. */
  readonly compiled: boolean;
}

export interface PreviewImage {
  readonly artwork: string;
  readonly format: string;
  readonly kind: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Served by this server; the bytes are the file `tyto render` wrote, read and sent. */
  readonly url: string;
  /** Where `tyto render` wrote it. */
  readonly path: string;
}

export type PreviewStatus = 'starting' | 'building' | 'rendering' | 'ok' | 'failed';

export interface PreviewState {
  readonly template: string;
  readonly brief: string;
  readonly generation: number;
  readonly status: PreviewStatus;
  /** `tyto render`'s own verdict for the generation shown: `ok`, `partial`, `error`. */
  readonly renderStatus?: string;
  readonly exitCode?: number;
  readonly images: readonly PreviewImage[];
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly command?: string;
  /** Wall clock of the rebuild, when there was one. */
  readonly buildMs?: number;
  /** Wall clock of `tyto render` alone. */
  readonly renderMs?: number;
  /** From the first file change this generation answers to, to its images being servable. */
  readonly changeToPictureMs?: number;
  readonly finishedAt?: string;
}

export interface PreviewPorts {
  readonly render: (request: RenderRequest) => Promise<RenderOutcome>;
  readonly rebuild: () => Promise<RebuildOutcome>;
  readonly now: () => number;
}

const DEFAULT_PORTS: PreviewPorts = {
  render: renderWithTyto,
  rebuild: rebuildTemplates,
  now: () => performance.now(),
};

interface Pending {
  rebuild: boolean;
  since: number;
}

export class PreviewSession {
  private state: PreviewState;
  private readonly listeners = new Set<(state: PreviewState) => void>();
  private pending: Pending | undefined;
  private running: Promise<void> | undefined;
  /**
   * Set when a rebuild failed and cleared only by one that succeeded.
   *
   * The failed build left the previous `dist/` in place, so rendering on the next save of
   * a `manifest.yaml` would draw the code from before the broken one — a stale picture
   * arrived at by a different road.
   */
  private buildBroken = false;
  private previousFolder: string | undefined;

  private readonly target: PreviewTarget;
  private readonly outputRoot: string;
  private readonly ports: PreviewPorts;

  // Fields assigned by hand rather than as parameter properties: Node's type stripping,
  // which `pnpm start` runs this through, refuses syntax that emits code.
  constructor(target: PreviewTarget, outputRoot: string, ports: PreviewPorts = DEFAULT_PORTS) {
    this.target = target;
    this.outputRoot = outputRoot;
    this.ports = ports;
    this.state = {
      template: target.template,
      brief: target.brief,
      generation: 0,
      status: 'starting',
      images: [],
      diagnostics: [],
    };
  }

  current(): PreviewState {
    return this.state;
  }

  onChange(listener: (state: PreviewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Asks for a redraw. Calls that arrive while one is running collapse into one more, so
   * a burst of saves costs two renders and not one per save.
   */
  request(options: { readonly rebuild: boolean }): Promise<void> {
    const rebuild = options.rebuild && this.target.compiled;
    this.pending =
      this.pending === undefined
        ? { rebuild, since: this.ports.now() }
        : { rebuild: this.pending.rebuild || rebuild, since: this.pending.since };
    this.running ??= this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** Resolves once nothing is queued or running. */
  async settled(): Promise<void> {
    while (this.running !== undefined) await this.running;
  }

  private publish(state: PreviewState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private async drain(): Promise<void> {
    while (this.pending !== undefined) {
      const job = this.pending;
      this.pending = undefined;
      await this.once(job);
    }
  }

  private async once(job: Pending): Promise<void> {
    const generation = this.state.generation + 1;
    let buildMs: number | undefined;

    if (this.target.compiled && (job.rebuild || this.buildBroken)) {
      this.publish({ ...this.state, status: 'building' });
      const started = this.ports.now();
      const built = await this.ports.rebuild();
      buildMs = Math.round(this.ports.now() - started);
      this.buildBroken = !built.ok;
      if (!built.ok) {
        await this.replaceFolder(undefined);
        this.publish({
          template: this.target.template,
          brief: this.target.brief,
          generation,
          status: 'failed',
          images: [],
          diagnostics: built.diagnostics,
          buildMs,
          changeToPictureMs: Math.round(this.ports.now() - job.since),
          finishedAt: new Date().toISOString(),
        });
        return;
      }
    }

    this.publish({ ...this.state, status: 'rendering' });
    const folder = join(this.outputRoot, String(generation));
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });

    const started = this.ports.now();
    const outcome = await this.ports.render({
      brief: this.target.brief,
      out: folder,
      templates: this.target.templates,
      formatsFile: this.target.formatsFile,
      types: this.target.types,
    });
    const renderMs = Math.round(this.ports.now() - started);

    // Hashed from the file on disk, which is also what the server sends: the number on the
    // page and the bytes behind the image are one read of one file.
    const images = await Promise.all(
      outcome.artifacts.map(async (artifact): Promise<PreviewImage> => {
        const path = join(folder, artifact.name);
        const bytes = await readFile(path);
        return {
          artwork: artifact.artwork,
          format: artifact.format,
          kind: artifact.kind,
          mime: artifact.mime,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          url: `/out/${String(generation)}/${encodeURIComponent(artifact.name)}`,
          path,
        };
      }),
    );

    await this.replaceFolder(folder);
    this.publish({
      template: this.target.template,
      brief: this.target.brief,
      generation,
      status: outcome.exitCode === 0 ? 'ok' : 'failed',
      renderStatus: outcome.status,
      exitCode: outcome.exitCode,
      images,
      diagnostics: outcome.diagnostics,
      command: outcome.command,
      ...(buildMs === undefined ? {} : { buildMs }),
      renderMs,
      changeToPictureMs: Math.round(this.ports.now() - job.since),
      finishedAt: new Date().toISOString(),
    });
  }

  private async replaceFolder(next: string | undefined): Promise<void> {
    const previous = this.previousFolder;
    this.previousFolder = next;
    if (previous !== undefined && previous !== next) {
      await rm(previous, { recursive: true, force: true });
    }
  }

  /** The folder of the generation on the page, which is the only one the server serves. */
  servedFolder(generation: number): string | undefined {
    return generation === this.state.generation && this.state.images.length > 0
      ? join(this.outputRoot, String(generation))
      : undefined;
  }
}
