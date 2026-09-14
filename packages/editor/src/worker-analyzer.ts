import { type BriefAnalysis, type BriefAnalyzer } from './analysis.js';

/**
 * The same `BriefAnalyzer`, with the work on the other side of a worker.
 *
 * `parse` + `resolve` run on every debounce over the whole document, and the thread that
 * runs them is the thread that paints the caret. For the example briefs the cost is
 * invisible; for the twelve-slide carousels the templates are built for it is the
 * difference between typing and watching the editor catch up. Both halves of the protocol
 * live in this file on purpose — a request shape and a response shape in two files are two
 * things that drift.
 *
 * Nothing here constructs the worker. A library cannot: `new Worker(new URL(…))` is
 * resolved by whichever bundler the host uses, and this package is consumed by
 * `apps/desktop` (electron-vite), by the demo (Vite) and, later, by a web build. The host
 * makes the worker, points it at a module that calls `serveBriefAnalysis`, and passes it
 * here.
 */

/**
 * The part of `Worker` — and of a worker's own global scope — this protocol uses.
 *
 * Structural rather than `Worker` and `DedicatedWorkerGlobalScope`, because the second is
 * in TypeScript's `WebWorker` lib and this package compiles against `DOM`
 * (`tsconfig.dom.json`); the two libs conflict, and naming the shape avoids choosing. It
 * also lets a test drive both halves over a `MessageChannel`.
 */
export interface AnalysisEndpoint {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/**
 * Tagged, because a host is allowed to reuse one worker for more than this.
 *
 * `BriefAnalysis` crosses as-is: diagnostics are plain data by construction (ADR 0013) and
 * a `TemplateManifest` is what Zod parsed out of YAML, so the structured clone algorithm
 * takes both without a serializer in between.
 */
interface AnalyzeRequest {
  readonly tyto: 'analyze';
  readonly id: number;
  readonly source: string;
}

interface AnalyzeResponse {
  readonly tyto: 'analyzed';
  readonly id: number;
  readonly analysis: BriefAnalysis;
}

const isResponse = (data: unknown): data is AnalyzeResponse =>
  typeof data === 'object' && data !== null && (data as { tyto?: unknown }).tyto === 'analyzed';

const isRequest = (data: unknown): data is AnalyzeRequest =>
  typeof data === 'object' && data !== null && (data as { tyto?: unknown }).tyto === 'analyze';

/**
 * The main-thread half: posts a document, resolves when its answer comes back.
 *
 * Requests are kept by id rather than assumed to answer in order, because they do not have
 * to — and `briefLint` already drops an answer that arrives after a newer one, so an
 * out-of-order pair costs a wasted render and never a stale marker.
 */
export function createWorkerAnalyzer(endpoint: AnalysisEndpoint): BriefAnalyzer {
  const pending = new Map<number, (analysis: BriefAnalysis) => void>();
  let issued = 0;

  endpoint.addEventListener('message', (event: MessageEvent) => {
    if (!isResponse(event.data)) return;
    const settle = pending.get(event.data.id);
    if (settle === undefined) return;
    pending.delete(event.data.id);
    settle(event.data.analysis);
  });

  return {
    analyze: (source: string): Promise<BriefAnalysis> => {
      issued += 1;
      const id = issued;
      return new Promise<BriefAnalysis>((settle) => {
        pending.set(id, settle);
        const request: AnalyzeRequest = { tyto: 'analyze', id, source };
        endpoint.postMessage(request);
      });
    },
  };
}

/**
 * The worker half: answers requests with a locally built analyzer.
 *
 * A worker module is four lines — build an analyzer from the manifests the host sent, and
 * call this with its own scope:
 *
 * ```ts
 * serveBriefAnalysis(self as unknown as AnalysisEndpoint, createBriefAnalyzer({ manifests }));
 * ```
 */
export function serveBriefAnalysis(endpoint: AnalysisEndpoint, analyzer: BriefAnalyzer): void {
  endpoint.addEventListener('message', (event: MessageEvent) => {
    if (!isRequest(event.data)) return;
    const { id, source } = event.data;
    void analyzer.analyze(source).then((analysis) => {
      const response: AnalyzeResponse = { tyto: 'analyzed', id, analysis };
      endpoint.postMessage(response);
    });
  });
}
