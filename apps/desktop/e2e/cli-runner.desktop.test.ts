import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * `tyto` commands run in main for the window (TYTO-495, ADR 0159).
 *
 * Only what needs the real window is here: the five `cli:` names across the preload, a command
 * started by words and streamed back, the CLI's command tree in Electron's main, the window's
 * own rasterizer behind `render`, and Stop through IPC. The runner's rules — ids, states, the
 * box, the refusals — are `src/main/cli-runner.test.ts` and `src/main/cli-refusals.test.ts`.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139). No panel draws any of this yet
 * (TYTO-496): the page calls the bridge the way the panel will.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const FIXTURES = resolve(here, '..', '..', '..', 'packages', 'command-line', 'src', '__fixtures__');

for (const file of [built, FIXTURES]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

/** A real 1×1 PNG: the fixture brief draws `./logo.png`. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let scratch: string;
let work: string;
let app: ElectronApplication;
let page: Page;

interface Ended {
  readonly runId: string;
  readonly state: string;
  readonly code?: number;
  readonly out: string;
  readonly err: string;
}

/**
 * Runs `tyto <argv>` through the bridge and settles when its run ends, or `cancel` once it has
 * started and settles on `cancelled`. Every push is collected from before the request, because
 * `running` may arrive before the id does.
 */
function tyto(argv: readonly string[], cancel = false): Promise<Ended> {
  return page.evaluate(
    ([words, stop]) => {
      type Bridge = Record<string, (request: unknown) => Promise<{ runId: string }>> & {
        on: (event: string, listen: (payload: never) => void) => () => void;
      };
      const bridge = (window as unknown as { tyto: Bridge }).tyto;
      const outputs: { runId: string; stream: string; text: string }[] = [];
      const states: { runId: string; state: string; code?: number }[] = [];
      return new Promise<Ended>((done) => {
        let runId: string | undefined;
        const check = (): void => {
          const end = states.find(
            (change) =>
              change.runId === runId &&
              (change.state === 'finished' || change.state === 'cancelled'),
          );
          if (end === undefined || runId === undefined) return;
          const mine = outputs.filter((output) => output.runId === runId);
          const text = (stream: string) =>
            mine
              .filter((output) => output.stream === stream)
              .map((output) => output.text)
              .join('');
          done({ ...end, out: text('out'), err: text('err') });
        };
        bridge.on('cli:output', (payload: never) => {
          outputs.push(payload);
        });
        bridge.on('cli:state', (payload: { runId: string; state: string }) => {
          states.push(payload);
          if (stop && payload.runId === runId && payload.state === 'running') {
            void bridge['cli:cancel']!({ runId });
          }
          check();
        });
        void bridge['cli:run']!({ argv: words }).then((started) => {
          runId = started.runId;
          if (stop) void bridge['cli:cancel']!({ runId });
          check();
        });
      });
    },
    [argv, cancel] as const,
  );
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-cli-runner-e2e-'));
  work = join(scratch, 'work');
  // The CLI's own fixture project: `templates/cartaz/`, `formats.yaml` and a task folder.
  const template = join(work, 'templates', 'cartaz');
  mkdirSync(join(template, 'assets'), { recursive: true });
  mkdirSync(join(work, 'task', 'assets'), { recursive: true });
  const copy = (from: string, to: string): void => {
    writeFileSync(to, readFileSync(join(FIXTURES, from)));
  };
  copy('cartaz.manifest.yaml', join(template, 'manifest.yaml'));
  copy('cartaz.html', join(template, 'template.html'));
  copy('mark.svg', join(template, 'assets', 'mark.svg'));
  copy('formats.yaml', join(work, 'formats.yaml'));
  copy('cartaz.brief', join(work, 'task', 'brief.brief'));
  writeFileSync(join(work, 'task', 'assets', 'logo.png'), LOGO_PNG);
  mkdirSync(join(work, 'queue', 'inbox'), { recursive: true });

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a tyto command in the window', () => {
  it('lists the plugins, streamed back with its exit code', async () => {
    const ended = await tyto(['plugin', 'list']);

    expect(ended.state, ended.err).toBe('finished');
    expect(ended.code).toBe(0);
    expect(ended.out).toContain('built-in-templates');
    expect(ended.out).toContain('chromium');
  });

  it('renders a brief to the folder it names, through the window', async () => {
    const out = join(work, 'out');
    const ended = await tyto([
      'render',
      join(work, 'task', 'brief.brief'),
      '--out',
      out,
      '--types',
      'svg',
      '--templates',
      join(work, 'templates'),
      '--formats-file',
      join(work, 'formats.yaml'),
    ]);

    expect(ended.code, ended.err).toBe(0);
    expect(ended.out.trim().split(/\r?\n/u)).toEqual(['feed-01.svg', 'feed-02.svg']);
    expect(readdirSync(out).sort()).toEqual(['feed-01.svg', 'feed-02.svg', 'result.json']);
  });

  it('answers a refused command line with exit 1 and the rule', async () => {
    const ended = await tyto(['render', join(work, 'task', 'brief.brief'), '--trust']);

    expect(ended.code).toBe(1);
    expect(ended.err).toContain('Workspace: Trust');
  });

  it('stops a watch through cli:cancel', async () => {
    const ended = await tyto(
      ['watch', join(work, 'queue'), '--interval', '50', '--types', 'svg'],
      true,
    );

    expect(ended.state).toBe('cancelled');
    expect(ended.code).toBeUndefined();
  });

  it('describes its command tree', async () => {
    const tree = await page.evaluate(() =>
      (
        window as unknown as {
          tyto: Record<
            string,
            (request: unknown) => Promise<{ tree: { commands: { name: string }[] } }>
          >;
        }
      ).tyto['cli:commands']!({}),
    );

    expect(tree.tree.commands.map((command) => command.name)).toEqual(
      expect.arrayContaining(['render', 'watch', 'plugin', 'template', 'trust']),
    );
  });
});
