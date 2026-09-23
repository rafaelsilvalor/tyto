import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { REPOSITORY_ROOT, TYTO_BINARY } from './paths.ts';
import { type PreviewServer, startPreviewServer } from './server.ts';
import {
  type PreviewPorts,
  type PreviewState,
  type PreviewTarget,
  PreviewSession,
} from './session.ts';

/**
 * What the two test suites share: a preview on a free port, and `tyto render` run a second
 * time on its own, the way a person would, so the two sets of bytes can be compared.
 */

export interface RunningPreview {
  readonly session: PreviewSession;
  readonly server: PreviewServer;
  readonly outputRoot: string;
  state(): Promise<PreviewState>;
  /** sha256 of each image as the server sends it, by file name. */
  servedHashes(): Promise<Map<string, string>>;
  stop(): Promise<void>;
}

export const sha256 = (bytes: Buffer | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export interface Fetched {
  readonly status: number;
  readonly body: Buffer;
}

/** A GET against the preview. `node:http` because a Node package here may not use `fetch`. */
export function getFrom(url: string | URL): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
      );
      response.on('error', reject);
    }).on('error', reject);
  });
}

export async function startPreview(
  target: PreviewTarget,
  ports?: PreviewPorts,
): Promise<RunningPreview> {
  const outputRoot = await mkdtemp(join(tmpdir(), 'tyto-preview-test-'));
  const session = new PreviewSession(target, outputRoot, ports);
  const server = await startPreviewServer(session, 0);

  const state = async (): Promise<PreviewState> =>
    JSON.parse(
      (await getFrom(new URL('api/state', server.url))).body.toString('utf8'),
    ) as PreviewState;

  return {
    session,
    server,
    outputRoot,
    state,
    async servedHashes() {
      const hashes = new Map<string, string>();
      for (const image of (await state()).images) {
        const response = await getFrom(new URL(image.url, server.url));
        if (response.status !== 200) {
          throw new Error(`${image.url} answered ${String(response.status)}`);
        }
        const name = decodeURIComponent(image.url.split('/').at(-1) ?? '');
        hashes.set(name, sha256(response.body));
      }
      return hashes;
    },
    async stop() {
      await session.settled();
      await server.close();
      await rm(outputRoot, { recursive: true, force: true });
    },
  };
}

const run = promisify(execFile);

/** `tyto render` by hand into a folder of its own; sha256 of each image it wrote, by name. */
export async function renderByHand(target: PreviewTarget): Promise<Map<string, string>> {
  const out = await mkdtemp(join(tmpdir(), 'tyto-by-hand-'));
  try {
    await run(
      process.execPath,
      [
        TYTO_BINARY,
        'render',
        target.brief,
        '--out',
        out,
        '--templates',
        target.templates,
        '--formats-file',
        target.formatsFile,
        '--types',
        target.types.join(','),
      ],
      { cwd: REPOSITORY_ROOT },
    );
    const hashes = new Map<string, string>();
    for (const name of (await readdir(out)).sort()) {
      if (name === 'result.json') continue;
      hashes.set(name, sha256(await readFile(join(out, name))));
    }
    return hashes;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
