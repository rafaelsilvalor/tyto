import { execFile } from 'node:child_process';
import { join, relative } from 'node:path';

import { REBUILD_SCRIPT, REPOSITORY_ROOT, TEMPLATES_PACKAGE, TYTO_BINARY } from './paths.ts';

/**
 * The two programs this tool runs, and what it reads back from them.
 *
 * Neither is reimplemented here. A render is `node apps/cli/dist/index.js render … --json`
 * in a child process, exactly the command a person types; a rebuild is tsup on
 * `@tyto/templates` with that package's own config. What the page shows is therefore
 * whatever those two wrote to disk, and a change to either reaches the page with no change
 * to this tool.
 */

/** One diagnostic as `tyto render --json` prints it: located, with a line and a column. */
export interface PreviewDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly hint?: string;
}

/** One artifact entry of `tyto render --json`. */
export interface RenderedArtifact {
  readonly name: string;
  readonly artwork: string;
  readonly format: string;
  readonly kind: string;
  readonly mime: string;
  readonly bytes: number;
}

export interface RenderRequest {
  readonly brief: string;
  readonly out: string;
  readonly templates: string;
  readonly formatsFile: string;
  readonly types: readonly string[];
  /** Another binary in place of the built CLI. Tests use it to prove the page breaks with it. */
  readonly binary?: string;
}

export interface RenderOutcome {
  /** The process's exit code: 0 ok, 1 diagnostics, 2 internal failure (ADR 0011). */
  readonly exitCode: number;
  readonly status: string;
  readonly artifacts: readonly RenderedArtifact[];
  readonly diagnostics: readonly PreviewDiagnostic[];
  /** The command line, as a person would retype it from the repository root. */
  readonly command: string;
  /** What the process wrote to stderr. Empty on a run that produced its JSON. */
  readonly stderr: string;
}

interface Exited {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function spawnNode(args: readonly string[], cwd: string): Promise<Exited> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...args],
      { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

function shown(path: string): string {
  const inside = relative(REPOSITORY_ROOT, path);
  return inside === '' || inside.startsWith('..') ? path : inside.split('\\').join('/');
}

export async function renderWithTyto(request: RenderRequest): Promise<RenderOutcome> {
  const binary = request.binary ?? TYTO_BINARY;
  const args = [
    'render',
    request.brief,
    '--out',
    request.out,
    '--templates',
    request.templates,
    '--formats-file',
    request.formatsFile,
    '--types',
    request.types.join(','),
    '--json',
  ];
  const command = ['node', shown(binary), ...args.map((arg) => shown(arg))].join(' ');

  const exited = await spawnNode([binary, ...args], REPOSITORY_ROOT);

  let document: {
    status?: string;
    artifacts?: RenderedArtifact[];
    diagnostics?: PreviewDiagnostic[];
  };
  try {
    document = JSON.parse(exited.stdout) as typeof document;
  } catch {
    // Exit 2, or a binary that is not there: there is no JSON, and what went wrong is on
    // stderr. Reported as a diagnostic so the page has one place to show failures.
    return {
      exitCode: exited.code,
      status: 'failed',
      artifacts: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'PREVIEW_TYTO_FAILED',
          message: `tyto render exited ${String(exited.code)} without a result: ${
            exited.stderr.trim() || exited.stdout.trim() || '(no output)'
          }`,
        },
      ],
      command,
      stderr: exited.stderr,
    };
  }

  return {
    exitCode: exited.code,
    status: document.status ?? 'failed',
    artifacts: document.artifacts ?? [],
    diagnostics: document.diagnostics ?? [],
    command,
    stderr: exited.stderr,
  };
}

export interface RebuildOutcome {
  readonly ok: boolean;
  readonly diagnostics: readonly PreviewDiagnostic[];
}

/** Rebuilds `@tyto/templates`, so the next `tyto render` imports the code just saved. */
export async function rebuildTemplates(): Promise<RebuildOutcome> {
  const exited = await spawnNode(['--experimental-strip-types', REBUILD_SCRIPT], TEMPLATES_PACKAGE);

  let document: {
    ok?: boolean;
    errors?: { text: string; file?: string; line?: number; column?: number }[];
  };
  try {
    document = JSON.parse(exited.stdout.trim().split('\n').at(-1) ?? '') as typeof document;
  } catch {
    document = { ok: false, errors: [{ text: exited.stderr.trim() || '(no output)' }] };
  }
  if (document.ok === true) return { ok: true, diagnostics: [] };

  return {
    ok: false,
    diagnostics: (document.errors ?? []).map((error) => ({
      severity: 'error',
      code: 'PREVIEW_BUILD_FAILED',
      message: error.text,
      ...(error.file === undefined ? {} : { path: shown(join(TEMPLATES_PACKAGE, error.file)) }),
      ...(error.line === undefined ? {} : { line: error.line }),
      // esbuild counts columns from 0 and `tyto render` from 1; the page shows one convention.
      ...(error.column === undefined ? {} : { column: error.column + 1 }),
    })),
  };
}
