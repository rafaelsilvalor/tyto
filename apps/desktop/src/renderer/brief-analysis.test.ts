import { describe, expect, it } from 'vitest';

import { type PublishedAnswer, previewAnalysis } from './brief-analysis.js';

const answer = (brief: string, code = 'E_UNKNOWN_DIRECTIVE'): PublishedAnswer => ({
  brief,
  diagnostics: [{ severity: 'error', code, message: 'm', range: { start: 0, end: 1 } }],
  completion: { directives: ['demo/shout'] },
});

/** Resolved yet, without waiting for it: a pending promise stays `'waiting'`. */
async function settled<T>(promise: Promise<T>): Promise<T | 'waiting'> {
  return Promise.race([
    promise,
    new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 10)),
  ]);
}

describe('previewAnalysis', () => {
  it('answers a wait with the preview answer about the same text', async () => {
    const { analyzer, publish } = previewAnalysis(() => ['promo-curso']);
    const waiting = analyzer.analyze('::demo/shout x');
    publish(answer('::demo/shout x'));

    const analysis = await waiting;
    expect(analysis.source).toBe('::demo/shout x');
    expect(analysis.directives).toEqual(['demo/shout']);
    expect(analysis.templates).toEqual(['promo-curso']);
    expect(analysis.diagnostics.map((item) => item.code)).toEqual(['E_UNKNOWN_DIRECTIVE']);
  });

  it('answers at once when the preview already compiled that text', async () => {
    const { analyzer, publish } = previewAnalysis(() => []);
    publish(answer('a'));
    expect((await settled(analyzer.analyze('a'))) === 'waiting').toBe(false);
  });

  it('never hands newer text an older answer', async () => {
    const { analyzer, publish } = previewAnalysis(() => []);
    const older = analyzer.analyze('a');
    const newer = analyzer.analyze('ab');
    publish(answer('a'));

    expect((await settled(older)) === 'waiting').toBe(false);
    expect(await settled(newer)).toBe('waiting');

    publish(answer('ab', 'E_UNKNOWN_SLOT'));
    const analysis = await newer;
    expect(analysis.diagnostics.map((item) => item.code)).toEqual(['E_UNKNOWN_SLOT']);
  });

  it('releases the waits a debounced preview skipped, with the answer after them', async () => {
    const { analyzer, publish } = previewAnalysis(() => []);
    const skipped = analyzer.analyze('a');
    const compiled = analyzer.analyze('ab');
    publish(answer('ab'));

    expect((await skipped).source).toBe('ab');
    expect((await compiled).source).toBe('ab');
  });

  it('keeps the manifest out when the preview found none', async () => {
    const { analyzer, publish } = previewAnalysis(() => []);
    publish(answer('a'));
    expect('manifest' in (await analyzer.analyze('a'))).toBe(false);
  });
});
