import { type AnalysisEndpoint, createBriefAnalyzer, serveBriefAnalysis } from '../src/index.js';

import { MANIFESTS } from './manifests.js';

/**
 * The whole worker: build an analyzer, answer requests with it.
 *
 * The demo is the smallest possible host on purpose (`demo/main.ts`), and this file is the
 * proof that the smallest possible host can get `parse` + `resolve` off the thread that
 * paints the caret without the package knowing anything about its bundler. `apps/desktop`
 * writes the same four lines against manifests it received from main instead of ones it
 * imported.
 */
serveBriefAnalysis(
  self as unknown as AnalysisEndpoint,
  createBriefAnalyzer({ manifests: MANIFESTS }),
);
