import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type PreviewPorts, type PreviewTarget, PreviewSession } from './session.ts';
import type { RebuildOutcome, RenderOutcome, RenderRequest } from './tyto.ts';

/**
 * The queue and the generations, with the two programs replaced by stand-ins that write a
 * file or fail. What `tyto render` itself does is `preview.test.ts`'s subject.
 */

const TARGET: PreviewTarget = {
  template: 'sample',
  brief: '/brief.brief',
  templates: '/templates',
  formatsFile: '/formats.yaml',
  types: ['png'],
  compiled: true,
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-preview-session-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Script {
  renders: RenderRequest[];
  rebuilds: number;
  renderFails: boolean;
  buildFails: boolean;
}

function ports(script: Script): PreviewPorts {
  return {
    now: () => performance.now(),
    rebuild: (): Promise<RebuildOutcome> => {
      script.rebuilds += 1;
      return Promise.resolve(
        script.buildFails
          ? {
              ok: false,
              diagnostics: [{ severity: 'error', code: 'PREVIEW_BUILD_FAILED', message: 'boom' }],
            }
          : { ok: true, diagnostics: [] },
      );
    },
    render: async (request): Promise<RenderOutcome> => {
      script.renders.push(request);
      if (script.renderFails) {
        return {
          exitCode: 1,
          status: 'error',
          artifacts: [],
          diagnostics: [{ severity: 'error', code: 'E_SYNTAX', message: 'broken', line: 3 }],
          command: 'tyto render',
          stderr: '',
        };
      }
      await writeFile(join(request.out, 'a-feed.png'), `bytes of ${request.out}`);
      return {
        exitCode: 0,
        status: 'ok',
        artifacts: [
          {
            name: 'a-feed.png',
            artwork: 'a',
            format: 'feed',
            kind: 'png',
            mime: 'image/png',
            bytes: 1,
          },
        ],
        diagnostics: [],
        command: 'tyto render',
        stderr: '',
      };
    },
  };
}

const fresh = (): Script => ({ renders: [], rebuilds: 0, renderFails: false, buildFails: false });

describe('PreviewSession', () => {
  it('shows no image after a failed render, and deletes the folder of the one before', async () => {
    const script = fresh();
    const session = new PreviewSession(TARGET, root, ports(script));

    await session.request({ rebuild: false });
    const first = session.current();
    expect(first.status).toBe('ok');
    expect(first.images).toHaveLength(1);
    const firstFolder = session.servedFolder(first.generation)!;
    expect(existsSync(firstFolder)).toBe(true);

    script.renderFails = true;
    await session.request({ rebuild: false });
    const second = session.current();

    expect(second.status).toBe('failed');
    expect(second.images).toEqual([]);
    expect(second.diagnostics.map((item) => item.code)).toEqual(['E_SYNTAX']);
    expect(session.servedFolder(first.generation)).toBeUndefined();
    expect(existsSync(firstFolder)).toBe(false);
  });

  it('does not render after a failed build, and rebuilds on every request until one works', async () => {
    const script = fresh();
    script.buildFails = true;
    const session = new PreviewSession(TARGET, root, ports(script));

    await session.request({ rebuild: true });
    expect(session.current().status).toBe('failed');
    expect(session.current().diagnostics[0]?.code).toBe('PREVIEW_BUILD_FAILED');
    expect(script.renders).toHaveLength(0);

    // A save of the manifest asks for no rebuild; the broken one before it still needs one,
    // or the render would draw the `dist/` from before the broken save.
    script.buildFails = false;
    await session.request({ rebuild: false });
    expect(script.rebuilds).toBe(2);
    expect(session.current().status).toBe('ok');
  });

  it('never rebuilds a template that is not compiled into the build', async () => {
    const script = fresh();
    const session = new PreviewSession({ ...TARGET, compiled: false }, root, ports(script));

    await session.request({ rebuild: true });
    expect(script.rebuilds).toBe(0);
    expect(script.renders).toHaveLength(1);
  });

  it('collapses a burst of requests into the one running and one more', async () => {
    const script = fresh();
    const session = new PreviewSession(TARGET, root, ports(script));

    const burst = [1, 2, 3, 4, 5].map(() => session.request({ rebuild: false }));
    await Promise.all(burst);
    await session.settled();

    expect(script.renders).toHaveLength(2);
    expect(session.current().generation).toBe(2);
  });
});
