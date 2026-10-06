import { defineConfig } from 'vitest/config';

/**
 * How many files run at once. One, unless `TYTO_E2E_WORKERS` says otherwise, and only
 * `desktop-e2e.yml` says otherwise (TYTO-235).
 *
 * Every suite has launched with its own `--user-data-dir` and `TYTO_HOME` since TYTO-139,
 * so two files no longer share anything but the machine. On CI the machine is a runner
 * that exists for this job, and three files at once cut the `desktop` check's wall time
 * (the numbers are in `docs/architecture.md`). On a maintainer's machine each file is an
 * Electron next to everything else that is open, memory is the constraint there, and a
 * second Electron per worker is the wrong trade — so the default stays one file at a
 * time, and parallelism is opted into by the one workflow that sets the variable rather
 * than inferred from `CI`, which other tools set too.
 */
const fileWorkers = (): number => {
  const raw = process.env['TYTO_E2E_WORKERS'];
  if (raw === undefined || raw === '') return 1;
  const workers = Number(raw);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`TYTO_E2E_WORKERS must be a positive integer, got '${raw}'`);
  }
  return workers;
};

const workers = fileWorkers();

export default defineConfig({
  test: {
    include: ['e2e/**/*.desktop.test.ts'],
    // Before any worker starts, so parallel files never race to download the binary.
    globalSetup: ['e2e/electron-binary.global-setup.ts'],
    // Launching Electron is seconds, not milliseconds, and the first run on a machine also
    // downloads the binary. The 5s default would read that as a hang.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: workers > 1,
    maxWorkers: workers,
  },
});
