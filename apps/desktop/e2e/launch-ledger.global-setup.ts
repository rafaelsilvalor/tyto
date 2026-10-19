import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

import {
  LEDGER_PREFIX,
  type LedgerOwner,
  type LedgerSweep,
  OWNER_FILE,
  endRecordedLaunches,
  sweepAbandonedRuns,
} from './launch-ledger.js';

/**
 * The run's launch ledger: made before any worker starts, ended after the last (TYTO-292, ADR 0106).
 *
 * Runs in the main vitest process, which outlives a worker that crashes — vitest runs a global
 * setup's teardown when the run ends for any reason it controls, a worker's `Worker exited
 * unexpectedly` included, and `orphan-guard.desktop.test.ts` is what makes that a measured fact.
 */

const summary = (label: string, sweep: LedgerSweep): string =>
  `[TYTO-292] ${label}: ${String(sweep.recorded)} launch(es) recorded, ` +
  `${String(sweep.killed.length)} process(es) still running and ended ${JSON.stringify(sweep.killed)}, ` +
  `survivors ${JSON.stringify(sweep.survivors)}\n`;

export default function setUpLaunchLedger(project: TestProject): () => void {
  const folder = mkdtempSync(join(tmpdir(), LEDGER_PREFIX));
  const owner: LedgerOwner = {
    pid: process.pid,
    // When this process was created, as the operating system will report it to a later sweep.
    startedAt: Date.now() - Math.round(process.uptime() * 1_000),
  };
  writeFileSync(join(folder, OWNER_FILE), JSON.stringify(owner), 'utf8');

  for (const sweep of sweepAbandonedRuns(folder)) {
    if (sweep.killed.length > 0) {
      process.stdout.write(summary('abandoned run', sweep));
    }
  }

  project.provide('launchLedger', folder);

  return () => {
    const sweep = endRecordedLaunches(folder);
    // Printed only when the teardown had something to end: on a clean run every app was closed
    // by its suite, and the line would be noise in every log.
    if (sweep.killed.length > 0) {
      process.stdout.write(summary('this run', sweep));
    }
    rmSync(folder, { recursive: true, force: true });
  };
}
