import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type BriefAnalysis, type BriefAnalyzer, createBriefAnalyzer } from './analysis.js';
import {
  type AnalysisEndpoint,
  createWorkerAnalyzer,
  serveBriefAnalysis,
} from './worker-analyzer.js';

const manifestOf = (yaml: string): TemplateManifest => {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error('fixture manifest does not parse');
  return parsed.value;
};

const CARROSSEL = manifestOf(`
name: carrossel-lista
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text, required: true, max: 60 }
  item: { type: rich-text, repeat: true, min: 1, max: 10 }
`);

const VALID = ['---', 'template: carrossel-lista', '---', '::titulo Lista', '::item Um'].join('\n');

/**
 * A real `MessageChannel`, not two functions calling each other.
 *
 * The claim worth testing is that a `BriefAnalysis` survives the trip, and what decides
 * that is the structured clone algorithm — a hand-rolled pair of endpoints would pass the
 * same object by reference and prove nothing about a manifest crossing a worker boundary.
 */
const connect = (analyzer: BriefAnalyzer): BriefAnalyzer => {
  const channel = new MessageChannel();
  serveBriefAnalysis(channel.port2 as unknown as AnalysisEndpoint, analyzer);
  channel.port2.start();
  const remote = createWorkerAnalyzer(channel.port1 as unknown as AnalysisEndpoint);
  channel.port1.start();
  return remote;
};

describe('createWorkerAnalyzer / serveBriefAnalysis', () => {
  it('answers with the analysis the other side produced', async () => {
    const local = createBriefAnalyzer({ manifests: [CARROSSEL] });
    const remote = connect(local);

    const across = await remote.analyze(VALID);
    const beside = await local.analyze(VALID);

    expect(across.diagnostics).toEqual(beside.diagnostics);
    expect(across.manifest).toEqual(beside.manifest);
    expect(across.templates).toEqual(beside.templates);
    expect(across.source).toBe(VALID);
  });

  it('carries a diagnostic code, message, hint and range intact', async () => {
    const remote = connect(createBriefAnalyzer({ manifests: [CARROSSEL] }));
    const source = ['---', 'template: carrossel-lista', '---', '::titlo Lista', '::item Um'].join(
      '\n',
    );

    const analysis = await remote.analyze(source);
    const unknown = analysis.diagnostics.find((item) => item.code === 'E_UNKNOWN_SLOT');

    expect(unknown?.hint).toBe("Did you mean 'titulo'?");
    expect(source.slice(unknown?.range?.start ?? 0, unknown?.range?.end ?? 0)).toBe('titlo');
  });

  it('matches each answer to its own request when they come back out of order', async () => {
    const settlers: ((analysis: BriefAnalysis) => void)[] = [];
    const controlled: BriefAnalyzer = {
      analyze: (source: string) =>
        new Promise<BriefAnalysis>((settle) => {
          settlers.push(() => {
            settle({ source, diagnostics: [], templates: [source] });
          });
        }),
    };
    const remote = connect(controlled);

    const first = remote.analyze('first');
    const second = remote.analyze('second');

    // Both requests have to have crossed before either is answered. Waited for rather than
    // assumed after one tick: a port delivers on a macrotask, and how many ticks that takes
    // is the event loop's business — a fixed `setTimeout(0)` passes this file on its own and
    // fails it when the rest of the suite is running beside it.
    const started = Date.now();
    while (settlers.length < 2) {
      if (Date.now() - started > 2000) throw new Error('both requests never crossed');
      await new Promise((resume) => setTimeout(resume, 1));
    }

    settlers[1]?.({ source: 'second', diagnostics: [], templates: [] });
    settlers[0]?.({ source: 'first', diagnostics: [], templates: [] });

    expect((await first).source).toBe('first');
    expect((await second).source).toBe('second');
  });

  it('ignores traffic that is not its own, so a host may share the worker', async () => {
    const channel = new MessageChannel();
    serveBriefAnalysis(
      channel.port2 as unknown as AnalysisEndpoint,
      createBriefAnalyzer({ manifests: [CARROSSEL] }),
    );
    channel.port2.start();
    const remote = createWorkerAnalyzer(channel.port1 as unknown as AnalysisEndpoint);
    channel.port1.start();

    const seen: unknown[] = [];
    channel.port1.addEventListener('message', (event) => seen.push((event as MessageEvent).data));

    channel.port2.postMessage({ kind: 'something-else' });
    channel.port1.postMessage({ kind: 'also-not-ours' });

    const analysis = await remote.analyze(VALID);

    expect(analysis.manifest?.name).toBe('carrossel-lista');
    // The foreign message reached the port and was simply not treated as a response.
    expect(seen).toContainEqual({ kind: 'something-else' });
  });
});
