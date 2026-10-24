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
    publish('', answer('::demo/shout x'));

    const analysis = await waiting;
    expect(analysis.source).toBe('::demo/shout x');
    expect(analysis.directives).toEqual(['demo/shout']);
    expect(analysis.templates).toEqual(['promo-curso']);
    expect(analysis.diagnostics.map((item) => item.code)).toEqual(['E_UNKNOWN_DIRECTIVE']);
  });

  it('answers at once when the preview already compiled that text', async () => {
    const { analyzer, publish } = previewAnalysis(() => []);
    publish('', answer('a'));
    expect((await settled(analyzer.analyze('a'))) === 'waiting').toBe(false);
  });

  it('never hands newer text an older answer', async () => {
    const { analyzer, publish } = previewAnalysis(() => []);
    const older = analyzer.analyze('a');
    const newer = analyzer.analyze('ab');
    publish('', answer('a'));

    expect((await settled(older)) === 'waiting').toBe(false);
    expect(await settled(newer)).toBe('waiting');

    publish('', answer('ab', 'E_UNKNOWN_SLOT'));
    const analysis = await newer;
    expect(analysis.diagnostics.map((item) => item.code)).toEqual(['E_UNKNOWN_SLOT']);
  });

  it('releases the waits a debounced preview skipped, with the answer after them', async () => {
    const { analyzer, publish } = previewAnalysis(() => []);
    const skipped = analyzer.analyze('a');
    const compiled = analyzer.analyze('ab');
    publish('', answer('ab'));

    expect((await skipped).source).toBe('ab');
    expect((await compiled).source).toBe('ab');
  });

  it('answers each document’s waits with that document’s preview only (TYTO-286)', async () => {
    const left = {};
    const right = {};
    const { analyzer, publish } = previewAnalysis(
      () => [],
      (view) => (view === left ? 'document-1' : view === right ? 'document-2' : undefined),
    );
    const leftWait = analyzer.analyze('a', left);
    const rightWait = analyzer.analyze('b', right);
    publish('document-2', answer('b'));
    expect(await settled(leftWait)).toBe('waiting');
    expect((await rightWait).source).toBe('b');
    publish('document-1', answer('a'));
    expect((await leftWait).source).toBe('a');
  });

  it('keeps the manifest out when the preview found none', async () => {
    const { analyzer, publish } = previewAnalysis(() => []);
    publish('', answer('a'));
    expect('manifest' in (await analyzer.analyze('a'))).toBe(false);
  });

  /**
   * A compile with no keystroke behind it — a templates folder, a trust, a fetch on save —
   * has no lint waiting for it, so nothing would draw it (TYTO-351). `relint` is the call that
   * makes the panes on that document lint again; the editor's own test measures the redraw.
   */
  it('asks for a relint of the document every answer was about, waited for or not', async () => {
    const relinted: string[] = [];
    const { analyzer, publish } = previewAnalysis(
      () => [],
      () => 'document-1',
      (documentId) => relinted.push(documentId),
    );
    publish('document-1', answer('a'));
    publish('document-1', answer('a', 'E_UNKNOWN_SLOT'));
    expect(relinted).toEqual(['document-1', 'document-1']);
    // And the relint reads the newer answer at once: the same text, a different verdict.
    const analysis = await settled(analyzer.analyze('a'));
    expect(
      analysis === 'waiting' ? analysis : analysis.diagnostics.map((item) => item.code),
    ).toEqual(['E_UNKNOWN_SLOT']);
  });
});
