import type {
  AssetRef,
  AssetResolver,
  Diagnostic,
  DirectoryEntry,
  FileSystem,
  TemplateRegistry,
} from '@tyto/core';
import { formatCatalogue, isError, loadTemplateRegistry } from '@tyto/core';
import type { RasterOptions, Rasterizer } from '@tyto/raster';
import { describe, expect, it } from 'vitest';

import type { Artifact, ArtifactSink } from './artifact.js';
import type { JobEvent } from './events.js';
import { type JobPorts, type JobResources, type OutputRequest, runJob } from './job.js';
import { markupTemplateSource } from './template-source.js';

import briefSource from './__fixtures__/promo-curso.brief?raw';
import manifestSource from './__fixtures__/manifest.yaml?raw';
import templateMarkup from './__fixtures__/template.html?raw';

/**
 * The job's three acceptance criteria are about counting, cancelling and not giving up, so
 * the tests are about those and the rasterizer is a fake.
 *
 * A real Chromium would make every case slower and none of them sharper: whether twelve
 * frames become twelve files, whether an abort stops the writing, and whether one broken
 * frame takes the other eleven with it are questions about the orchestration, and the
 * orchestration is what this package is. That the `Rasterizer` port really produces PNG
 * bytes is measured where the port lives, by `@tyto/raster`'s visual suite against
 * reference images. The two suites meet for the first time in E6.3, where the CLI is the
 * composition root and can wire the real adapter — which is also the first place the
 * missing test font (TYTO-61) will matter, since this fixture draws text.
 *
 * Everything else is real: the brief is parsed by the real parser, the template is read
 * through the real `FileSystem` port and compiled by the real `template-lang`, and
 * `resolve` and `compile` are the shipped ones. A job test that faked the stages would be
 * testing its own fakes.
 */

/* ------------------------------------------------------------- the world on a disk -- */

const FILES: Readonly<Record<string, string>> = {
  'templates/promo-curso/manifest.yaml': manifestSource,
  'templates/promo-curso/template.html': templateMarkup,
};

/** Directory listings derived from the file map, so the two cannot drift apart. */
function readDirectory(path: string): readonly DirectoryEntry[] {
  const prefix = `${path}/`;
  const found = new Map<string, boolean>();

  for (const file of Object.keys(FILES)) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf('/');
    found.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
  }

  if (found.size === 0) throw new Error(`ENOENT: no such directory '${path}'`);
  return [...found].map(([name, isDirectory]) => ({ name, isDirectory }));
}

const fileSystem: FileSystem = {
  join: (...segments) => segments.join('/'),
  readDirectory: (path) => Promise.resolve(readDirectory(path)),
  readFile: (path) => {
    const source = FILES[path];
    if (source === undefined) return Promise.reject(new Error(`ENOENT: no such file '${path}'`));
    return Promise.resolve(source);
  },
};

const PHOTO: AssetRef = { id: 'ana', source: 'file', path: './ana.png', hash: 'sha256-ana' };

const assets: AssetResolver = {
  base: 'briefs/',
  resolve: (reference) => Promise.resolve(reference === './ana.png' ? PHOTO : undefined),
};

const formats = formatCatalogue({
  feed: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
});

/**
 * Stubbed bytes, echoing what was asked for.
 *
 * The exporters refuse to embed a font or an asset they were given nothing for
 * (`E_EXPORT_FONT_UNRESOLVED`), and the repo bundles no font yet, so without these every
 * frame of this fixture would fail for a reason that has nothing to do with the job.
 */
const resources: JobResources = {
  html: {
    asset: (ref) => `data:image/png;base64,${ref.hash}`,
    font: (face) => `data:font/woff2;base64,${face.font.family}-${String(face.weight)}`,
  },
  svg: {
    asset: (ref) => `data:image/png;base64,${ref.hash}`,
    // `SvgFontFace` carries `family` where `HtmlFontFace` carries `font: FontRef`. The two
    // exporters describe a face differently, which is why the job passes the resolvers
    // through untouched instead of offering one shape and adapting.
    font: (face) => `data:font/woff2;base64,${face.family}-${String(face.weight)}`,
  },
};

async function registryOf(): Promise<TemplateRegistry> {
  const loaded = await loadTemplateRegistry(fileSystem, 'templates');
  if (!loaded.ok) throw new Error(loaded.error.map((item) => item.message).join('; '));
  return loaded.value;
}

/* ------------------------------------------------------------------- a fake browser -- */

interface FakeRasterizer extends Rasterizer {
  readonly calls: readonly { html: string; options: RasterOptions }[];
  /** The most frames that were ever in flight at once, for the concurrency test. */
  readonly peak: () => number;
}

interface FakeOptions {
  /** Returns a message to fail with, or `undefined` to succeed. */
  readonly failWhen?: (html: string, options: RasterOptions) => string | undefined;
  /** Yield to the event loop so overlapping work is really overlapping. */
  readonly delay?: boolean;
}

function fakeRasterizer(options: FakeOptions = {}): FakeRasterizer {
  const calls: { html: string; options: RasterOptions }[] = [];
  let active = 0;
  let peak = 0;

  return {
    calls,
    peak: () => peak,
    async raster(html, rasterOptions) {
      calls.push({ html, options: rasterOptions });
      active += 1;
      peak = Math.max(peak, active);

      try {
        if (options.delay === true) await new Promise((resolve) => setTimeout(resolve, 5));

        const failure = options.failWhen?.(html, rasterOptions);
        if (failure !== undefined) throw new Error(failure);

        // Not a real PNG, and it does not pretend to be: the bytes carry the size that
        // was asked for, so a test can tell one frame's output from another's.
        return new TextEncoder().encode(
          `${rasterOptions.format ?? 'png'}:${String(rasterOptions.width)}x${String(rasterOptions.height)}`,
        );
      } finally {
        active -= 1;
      }
    },
  };
}

interface RecordingSink extends ArtifactSink {
  readonly written: readonly Artifact[];
}

function recordingSink(failOn?: (artifact: Artifact) => string | undefined): RecordingSink {
  const written: Artifact[] = [];
  return {
    written,
    write(artifact) {
      const failure = failOn?.(artifact);
      if (failure !== undefined) return Promise.reject(new Error(failure));
      written.push(artifact);
      return Promise.resolve();
    },
  };
}

const BOTH: readonly OutputRequest[] = [{ kind: 'png' }, { kind: 'svg' }];

async function portsOf(extra: Partial<JobPorts> = {}): Promise<JobPorts> {
  const registry = await registryOf();
  return {
    registry,
    templates: markupTemplateSource(fileSystem, registry),
    assets,
    formats,
    resources,
    rasterizer: fakeRasterizer(),
    ...extra,
  };
}

function textOf(artifact: Artifact): string {
  return new TextDecoder().decode(artifact.bytes);
}

/* -------------------------------------------------------------------------- the ACs -- */

describe('a three-slide brief in two formats', () => {
  it('produces twelve artifacts with deterministic names', async () => {
    const sink = recordingSink();
    const result = await runJob({ brief: briefSource, outputs: BOTH }, await portsOf({ sink }));

    if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));

    expect(result.value.planned).toBe(12);
    expect(result.value.rendered).toBe(12);
    expect(result.value.failed).toBe(0);
    expect(result.value.cancelled).toBe(false);

    expect(result.value.artifacts.map((artifact) => artifact.name)).toEqual([
      'slide-1-feed.png',
      'slide-1-feed.svg',
      'slide-1-story.png',
      'slide-1-story.svg',
      'slide-2-feed.png',
      'slide-2-feed.svg',
      'slide-2-story.png',
      'slide-2-story.svg',
      'slide-3-feed.png',
      'slide-3-feed.svg',
      'slide-3-story.png',
      'slide-3-story.svg',
    ]);

    // Six of each, which is the acceptance criterion stated the other way round.
    const kinds = result.value.artifacts.map((artifact) => artifact.kind);
    expect(kinds.filter((kind) => kind === 'png')).toHaveLength(6);
    expect(kinds.filter((kind) => kind === 'svg')).toHaveLength(6);

    // The same twelve files, as a set: the sink is called in completion order, and an
    // SVG is finished long before the PNG of the same frame. `report.artifacts` is the
    // ordered view, and it is the one `result.json` is built from.
    expect([...sink.written].map((artifact) => artifact.name).sort()).toEqual(
      result.value.artifacts.map((artifact) => artifact.name).sort(),
    );
  });

  it('writes in scene order when only one frame runs at a time', async () => {
    const sink = recordingSink();
    const result = await runJob(
      { brief: briefSource, outputs: BOTH },
      await portsOf({ sink, concurrency: 1 }),
    );

    if (!result.ok) throw new Error('the job failed');

    // Not a promise the port makes — it is what the port's contract reduces to when
    // nothing overlaps, and the case is here so the difference from the test above is
    // visible rather than inferred.
    expect(sink.written.map((artifact) => artifact.name)).toEqual(
      result.value.artifacts.map((artifact) => artifact.name),
    );
  });

  it('lists the artifacts in scene order however the work interleaved', async () => {
    const rasterizer = fakeRasterizer({ delay: true });
    const result = await runJob(
      { brief: briefSource, outputs: BOTH },
      await portsOf({ rasterizer, concurrency: 4 }),
    );

    if (!result.ok) throw new Error('the job failed');

    // The delay makes the later frames finish first often enough that a report built by
    // pushing as work completed would be flaky here rather than wrong once.
    expect(result.value.artifacts[0]?.name).toBe('slide-1-feed.png');
    expect(result.value.artifacts.at(-1)?.name).toBe('slide-3-story.svg');
  });

  it('gives each frame its own size and format', async () => {
    const rasterizer = fakeRasterizer();
    const result = await runJob(
      { brief: briefSource, outputs: [{ kind: 'png' }] },
      await portsOf({ rasterizer }),
    );

    if (!result.ok) throw new Error('the job failed');

    expect(
      rasterizer.calls.map(
        (call) => `${String(call.options.width)}x${String(call.options.height)}`,
      ),
    ).toEqual(['1080x1080', '1080x1920', '1080x1080', '1080x1920', '1080x1080', '1080x1920']);
  });

  it('writes svg as utf-8 bytes rather than leaving the encoding to the sink', async () => {
    const result = await runJob(
      { brief: briefSource, outputs: [{ kind: 'svg' }] },
      await portsOf(),
    );

    if (!result.ok) throw new Error('the job failed');

    const first = result.value.artifacts[0];
    expect(first?.mime).toBe('image/svg+xml');
    expect(textOf(first ?? ({ bytes: new Uint8Array() } as Artifact)).startsWith('<svg')).toBe(
      true,
    );
  });
});

describe('cancellation', () => {
  it('stops writing and reports what had already landed', async () => {
    const controller = new AbortController();
    const sink = recordingSink();
    let finished = 0;

    const onEvent = (event: JobEvent): void => {
      if (event.kind !== 'frame-finished') return;
      finished += 1;
      // One frame in, one frame written. With concurrency 1 nothing else has started, so
      // the count below is a fact rather than a race.
      if (finished === 2) controller.abort();
    };

    const result = await runJob(
      { brief: briefSource, outputs: BOTH, signal: controller.signal },
      await portsOf({ sink, onEvent, concurrency: 1 }),
    );

    if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));

    expect(result.value.cancelled).toBe(true);
    expect(result.value.planned).toBe(12);
    expect(result.value.rendered).toBe(2);
    expect(sink.written).toHaveLength(2);
    expect(sink.written.map((artifact) => artifact.name)).toEqual([
      'slide-1-feed.png',
      'slide-1-feed.svg',
    ]);
  });

  it('renders nothing at all when the signal is already aborted', async () => {
    const sink = recordingSink();
    const result = await runJob(
      { brief: briefSource, outputs: BOTH, signal: AbortSignal.abort() },
      await portsOf({ sink }),
    );

    if (!result.ok) throw new Error('an abort before the work is not a failure');

    expect(result.value.cancelled).toBe(true);
    expect(result.value.planned).toBe(0);
    expect(sink.written).toHaveLength(0);
  });

  it('says it was cancelled through an event, not only in the report', async () => {
    const controller = new AbortController();
    const events: JobEvent[] = [];

    await runJob(
      { brief: briefSource, outputs: [{ kind: 'svg' }], signal: controller.signal },
      await portsOf({
        concurrency: 1,
        onEvent: (event) => {
          events.push(event);
          if (event.kind === 'frame-finished' && event.done === 1) controller.abort();
        },
      }),
    );

    expect(events.some((event) => event.kind === 'cancelled')).toBe(true);
  });
});

describe('one broken frame', () => {
  /** Every `story` frame fails to raster; the six `feed` and six `svg` should not care. */
  const rasterizer = (): FakeRasterizer =>
    fakeRasterizer({
      failWhen: (_html, options) => (options.height === 1920 ? 'the tab crashed' : undefined),
    });

  it('does not take the others with it', async () => {
    const sink = recordingSink();
    const result = await runJob(
      { brief: briefSource, outputs: BOTH },
      await portsOf({ sink, rasterizer: rasterizer() }),
    );

    // An error replaces the value (ADR 0013), so the job is an `Err` — but the nine
    // frames that worked were still rendered and still written.
    expect(result.ok).toBe(false);
    expect([...sink.written].map((artifact) => artifact.name).sort()).toEqual([
      'slide-1-feed.png',
      'slide-1-feed.svg',
      'slide-1-story.svg',
      'slide-2-feed.png',
      'slide-2-feed.svg',
      'slide-2-story.svg',
      'slide-3-feed.png',
      'slide-3-feed.svg',
      'slide-3-story.svg',
    ]);
  });

  it('reports every failure together, each naming its own frame', async () => {
    const result = await runJob(
      { brief: briefSource, outputs: BOTH },
      await portsOf({ rasterizer: rasterizer() }),
    );

    if (result.ok) throw new Error('three frames failed; the job should not be ok');

    const failures = result.error.filter((item) => item.code === 'E_RENDER_FAILED');
    expect(failures).toHaveLength(3);
    expect(failures.map((item: Diagnostic) => item.message)).toEqual([
      "Frame 'slide-1:story' could not be rendered as png: the tab crashed.",
      "Frame 'slide-2:story' could not be rendered as png: the tab crashed.",
      "Frame 'slide-3:story' could not be rendered as png: the tab crashed.",
    ]);
  });

  it('announces the failure as an event, with the running count', async () => {
    const events: JobEvent[] = [];
    await runJob(
      { brief: briefSource, outputs: BOTH },
      await portsOf({ rasterizer: rasterizer(), concurrency: 1, onEvent: (e) => events.push(e) }),
    );

    const failed = events.filter((event) => event.kind === 'frame-failed');
    expect(failed).toHaveLength(3);
    expect(failed.every((event) => event.kind === 'frame-failed' && event.total === 12)).toBe(true);
  });

  it('reports a sink that refuses one file without losing the rest', async () => {
    const sink = recordingSink((artifact) =>
      artifact.name === 'slide-2-feed.svg' ? 'EACCES' : undefined,
    );

    const result = await runJob({ brief: briefSource, outputs: BOTH }, await portsOf({ sink }));

    if (result.ok) throw new Error('a write that failed is an error');

    expect(result.error.filter((item) => item.code === 'E_OUTPUT_WRITE')).toHaveLength(1);
    expect(sink.written).toHaveLength(11);
  });
});

describe('a frame with no pixels', () => {
  it('is a diagnostic about the render, not a TypeError out of the port', async () => {
    const result = await runJob(
      { brief: briefSource, outputs: [{ kind: 'png' }] },
      await portsOf({ formats: formatCatalogue({ feed: { w: 0, h: 0 }, story: { w: 0, h: 0 } }) }),
    );

    if (result.ok) throw new Error('a zero-size frame cannot be rendered');

    const failures = result.error.filter((item) => item.code === 'E_RENDER_FAILED');
    expect(failures).toHaveLength(6);
    expect(failures[0]?.message).toContain('which is no pixels at all');
  });
});

describe('progress', () => {
  it('walks the stages in order and counts the frames once each', async () => {
    const events: JobEvent[] = [];
    const result = await runJob(
      { brief: briefSource, outputs: BOTH },
      await portsOf({ onEvent: (event) => events.push(event) }),
    );

    expect(result.ok).toBe(true);

    expect(
      events.filter((event) => event.kind === 'stage-started').map((event) => event.stage),
    ).toEqual(['parse', 'template', 'resolve', 'compile', 'render']);

    const planned = events.find((event) => event.kind === 'planned');
    expect(planned?.kind === 'planned' && planned.total).toBe(12);

    const finished = events.filter((event) => event.kind === 'frame-finished');
    expect(finished).toHaveLength(12);
    expect(finished.at(-1)?.kind === 'frame-finished' && finished.at(-1)?.done).toBe(12);
  });

  it('survives a listener that throws', async () => {
    const result = await runJob(
      { brief: briefSource, outputs: [{ kind: 'svg' }] },
      await portsOf({
        onEvent: () => {
          throw new Error('a progress bar with a bug');
        },
      }),
    );

    // The listener is a notification channel. Losing six rendered frames because a
    // progress bar threw would be the job punishing the wrong party.
    expect(result.ok && result.value.rendered).toBe(6);
  });
});

describe('the raster concurrency limit', () => {
  it('never has more frames in flight than it was allowed', async () => {
    const rasterizer = fakeRasterizer({ delay: true });
    await runJob(
      { brief: briefSource, outputs: [{ kind: 'png' }] },
      await portsOf({ rasterizer, concurrency: 2 }),
    );

    expect(rasterizer.peak()).toBeLessThanOrEqual(2);
    // And it did overlap: a limit that serialised everything would report 1 and pass the
    // assertion above while making the limit pointless.
    expect(rasterizer.peak()).toBe(2);
  });

  it('defaults to two rather than to unbounded', async () => {
    const rasterizer = fakeRasterizer({ delay: true });
    await runJob({ brief: briefSource, outputs: [{ kind: 'png' }] }, await portsOf({ rasterizer }));

    expect(rasterizer.peak()).toBe(2);
  });
});

describe('what the job refuses before it starts', () => {
  it('refuses a job with no outputs', async () => {
    await expect(runJob({ brief: briefSource, outputs: [] }, await portsOf())).rejects.toThrow(
      TypeError,
    );
  });

  it('refuses a raster output with no rasterizer, naming the formats', async () => {
    const ports = await portsOf();
    const { rasterizer: _ignored, ...withoutRasterizer } = ports;

    await expect(
      runJob(
        { brief: briefSource, outputs: [{ kind: 'png' }, { kind: 'webp' }] },
        withoutRasterizer,
      ),
    ).rejects.toThrow(/png, webp/);
  });

  it('renders svg alone with no rasterizer at all', async () => {
    const ports = await portsOf();
    const { rasterizer: _ignored, ...withoutRasterizer } = ports;

    const result = await runJob(
      { brief: briefSource, outputs: [{ kind: 'svg' }] },
      withoutRasterizer,
    );

    expect(result.ok && result.value.rendered).toBe(6);
  });
});

describe('the stages before the render', () => {
  it('stops at parse and reports the syntax, rendering nothing', async () => {
    const sink = recordingSink();
    const result = await runJob(
      { brief: '---\ntemplate: [not, a, string\n---\n::titulo Oi\n', outputs: BOTH },
      await portsOf({ sink }),
    );

    expect(result.ok).toBe(false);
    expect(sink.written).toHaveLength(0);
  });

  it('leaves E_UNKNOWN_TEMPLATE to resolve, which has the range and the suggestion', async () => {
    const result = await runJob(
      { brief: briefSource.replace('promo-curso', 'promo-cursos'), outputs: BOTH },
      await portsOf(),
    );

    if (result.ok) throw new Error('an unknown template is an error');

    const unknown = result.error.find((item) => item.code === 'E_UNKNOWN_TEMPLATE');
    expect(unknown?.hint).toBe("Did you mean 'promo-curso'?");
    expect(unknown?.range).toBeDefined();
  });

  it('reports a template file that is missing rather than an empty scene', async () => {
    const registry = await registryOf();
    const result = await runJob(
      { brief: briefSource, outputs: BOTH },
      await portsOf({
        registry,
        templates: markupTemplateSource(
          { ...fileSystem, readFile: () => Promise.reject(new Error('ENOENT')) },
          registry,
        ),
      }),
    );

    if (result.ok) throw new Error('a template that cannot be read is an error');
    expect(result.error.some((item) => item.code === 'E_TEMPLATE_READ')).toBe(true);
  });

  it('carries the warnings from every stage onto the success branch', async () => {
    // `subtitulo` is not a slot this manifest declares, so `resolve` reports it — as an
    // error, since an unknown slot is a typo. The point of the case is that the job does
    // not swallow what a stage said on its way past.
    const result = await runJob(
      { brief: briefSource.replace('::titulo', '::subtitulo Aulas\n::titulo'), outputs: BOTH },
      await portsOf(),
    );

    if (result.ok) throw new Error('an unknown slot is an error');
    expect(result.error.some((item) => item.code === 'E_UNKNOWN_SLOT' && isError(item))).toBe(true);
  });
});
