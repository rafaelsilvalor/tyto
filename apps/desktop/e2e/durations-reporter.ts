/**
 * Writes each e2e file's duration for the time budget (TYTO-310, ADR 0105), which
 * `tools/repo-checks/src/e2e-budget.mjs` judges in the `merge` job of `desktop-e2e.yml`.
 *
 * It reads vitest's own number for a file, `TestModule.diagnostic().duration`, because that is
 * the one that includes the file's `beforeAll` and `afterAll`: vitest 5's `runSuite` starts the
 * clock before `beforeAll` and stops it after `afterAll` and the fixture cleanup. Those hooks
 * are where an e2e file launches and closes Electron, so they are much of what the budget is
 * about — and they are what the JSON reporter's file times leave out.
 *
 * It is a reporter rather than a parse of the default reporter's lines so the check reads a
 * format this repository owns. Under `--merge-reports` it receives the shards' modules replayed
 * from their blobs, and `relativeModuleId` is the path the shard recorded, so the output is the
 * same on any machine that merges them.
 *
 *     vitest run --config vitest.desktop.config.ts --merge-reports=blob-reports \
 *       --reporter=default --reporter=./e2e/durations-reporter.ts
 *
 * The file goes to `blob-reports/durations.json` under the project root, or to the path in
 * `TYTO_E2E_DURATIONS`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Reporter, TestModule, Vitest } from 'vitest/node';

/** One row per e2e file: what `e2e-budget.mjs` reads. */
export interface FileDuration {
  /** Relative to `apps/desktop`, with forward slashes: `e2e/tabs.desktop.test.ts`. */
  readonly file: string;
  readonly tests: number;
  readonly durationMs: number;
}

export function durationsOf(testModules: ReadonlyArray<TestModule>): FileDuration[] {
  return testModules
    .map((testModule) => ({
      file: testModule.relativeModuleId.replaceAll('\\', '/'),
      tests: [...testModule.children.allTests()].length,
      durationMs: Math.round(testModule.diagnostic().duration),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export default class DurationsReporter implements Reporter {
  private root = process.cwd();

  onInit(vitest: Vitest): void {
    this.root = vitest.config.root;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const target = resolve(
      this.root,
      process.env['TYTO_E2E_DURATIONS'] ?? 'blob-reports/durations.json',
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(durationsOf(testModules), null, 2)}\n`);
    process.stdout.write(`durations of ${testModules.length} e2e files written to ${target}\n`);
  }
}
