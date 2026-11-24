import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  type Finding,
  type PackageReport,
  readTurboPlan,
  REPOSITORY_ROOT_LABEL,
  scanTestReads,
} from './turbo-inputs.js';

/**
 * Every file outside a package that its cached `test` task reads is in that task's hash
 * (TYTO-253, ADR 0072). How the reads are found and what the scan cannot see is written in
 * `turbo-inputs.ts`.
 *
 * A task whose resolved definition says `cache: false` never replays and is exempt; that is
 * read from Turborepo's plan, never decided here by a package name. Reads the scanner cannot
 * evaluate at all are counted in the output and never fail the check: on the day this was
 * written, every one sampled was a scratch folder, a path inside the package or a
 * dependency's own code.
 */
const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

interface Allowance {
  readonly packageName: string;
  readonly file: string;
  readonly reason: string;
}

/** Findings that are not reads. Each must still match one, or it is stale and fails. */
const ALLOWED: readonly Allowance[] = [
  {
    packageName: '@tyto/template-preview',
    file: REPOSITORY_ROOT_LABEL,
    reason:
      'the preview resolves a template name against the repository root and runs the CLI ' +
      'there; the only tracked files it reads under it are the built-in pack, which is ' +
      '`@tyto/templates`, a dependency whose build is in the hash',
  },
];

/** The packages whose `$TURBO_ROOT$` test inputs TYTO-52 added, the scan's own control. */
const DECLARED_BY_TYTO_52 = [
  '@tyto/command-line',
  '@tyto/editor',
  '@tyto/contract-test',
  '@tyto/docs-gen',
];

const SCAN_TIMEOUT = 180_000;

let reports: readonly PackageReport[] = [];
let cached: readonly PackageReport[] = [];

const allowed = (finding: Finding): boolean =>
  ALLOWED.some((entry) => entry.packageName === finding.packageName && entry.file === finding.file);

const describeFinding = (finding: Finding): string =>
  `${finding.packageName}: ${finding.file} <- ${finding.location} (${finding.via}) ${finding.why}`;

beforeAll(() => {
  const started = Date.now();
  reports = scanTestReads(ROOT, readTurboPlan(ROOT));
  cached = reports.filter((report) => !report.cacheDisabled);
  const scratch = cached.reduce((sum, report) => sum + report.opaque.scratch, 0);
  const other = cached.reduce((sum, report) => sum + report.opaque.other, 0);
  // Through stdout: Vitest swallows a passing test's console, and these numbers are the
  // scan's blind spot, which a reader of the CI log should be able to see.
  process.stdout.write(
    `turbo-inputs: ${String(cached.length)} cached test tasks of ${String(reports.length)}, ` +
      `${String(cached.reduce((sum, report) => sum + report.covered.length, 0))} covered reads, ` +
      `${String(scratch + other)} reads not evaluated (${String(scratch)} scratch folders, ` +
      `${String(other)} other), in ${String(Date.now() - started)} ms\n`,
  );
}, SCAN_TIMEOUT);

describe('the turbo inputs of every cached test task', () => {
  it('still sees the reads the TYTO-52 inputs were declared for', () => {
    // If the scan stops seeing these, it has gone blind, and an empty gap list proves nothing.
    const blind = DECLARED_BY_TYTO_52.filter(
      (name) =>
        !reports
          .find((report) => report.packageName === name)
          ?.covered.some((read) => read.reason === 'own inputs'),
    );
    expect(
      blind,
      'no read through a declared $TURBO_ROOT$ input was found in these packages: either the ' +
        'scan went blind, or the input and its read were removed on purpose (then take the ' +
        'package out of DECLARED_BY_TYTO_52)',
    ).toEqual([]);
  });

  it('hashes every file outside its package that a cached test task reads', () => {
    const gaps = cached.flatMap((report) => report.gaps).filter((finding) => !allowed(finding));
    expect(
      gaps.map(describeFinding),
      'a read outside the package is not in the task hash: add it to the package turbo.json ' +
        'test inputs as "$TURBO_ROOT$/<path>", or depend on the package that owns it',
    ).toEqual([]);
  });

  it('can name every repository file a cached test task builds a path to', () => {
    const unresolved = cached
      .flatMap((report) => report.unresolved)
      .filter((finding) => !allowed(finding));
    expect(
      unresolved.map(describeFinding),
      'a path built at runtime reaches files the task hash does not cover: declare them, or ' +
        'add an entry with its reason to ALLOWED in turbo-inputs.test.ts',
    ).toEqual([]);
  });

  it('allows nothing that no longer happens', () => {
    const findings = cached.flatMap((report) => [...report.gaps, ...report.unresolved]);
    const stale = ALLOWED.filter(
      (entry) =>
        !findings.some(
          (finding) => finding.packageName === entry.packageName && finding.file === entry.file,
        ),
    ).map((entry) => `${entry.packageName}: ${entry.file}`);
    expect(stale, 'ALLOWED entries that match nothing any more: remove them').toEqual([]);
  });
});
