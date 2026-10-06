import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The local queue panel in a running app (TYTO-45).
 *
 * **What the unit suites cannot say.** `queue.test.ts` drives the queue against real folders
 * with a fake render, and `queue-panel.test.ts` renders the panel in jsdom, which does no
 * layout. Neither walks the route a person takes — File menu, the dock opening a panel, a
 * native picker, `queue:changed` across the preload, a real render into `outbox/` — and
 * neither can tell whether the column is on screen at all.
 *
 * The card's two criteria, in order: a folder dropped into `inbox/` while the app is open
 * appears and renders on its own; a failed one shows its diagnostics, opens in the editor, is
 * fixed and saved there, and runs again from the panel.
 *
 * Its own `--user-data-dir`, so the layout, the settings and the recent list are this suite's
 * and not the machine's (TYTO-139 made that every suite's rule), and its
 * own `TYTO_HOME`, so no plugin or template installed on this machine can decide the outcome.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const GOOD = ['---', 'template: promo-curso', '---', '::titulo Da fila'].join('\n');
const BROKEN = ['---', 'template: nenhum-template', '---', '::titulo Quebrada'].join('\n');

/** An official template whose one repeating slot is one slide per occurrence. */
const agenda = (slides: number): string =>
  [
    '---',
    'template: agenda-semana',
    'formats: [grid]',
    '---',
    '::titulo',
    '  AGENDA DA SEMANA',
    ...Array.from({ length: slides }, (_unused, index) => [
      '::lamina',
      '  FARMÁCIA',
      `  0${String(index + 1)}/10 - 14:00 | Aula ${String(index + 1)} | Profª. Teste`,
    ]).flat(),
  ].join('\n');

let scratch: string;
let queueFolder: string;
let app: ElectronApplication;
let page: Page;

/** Every native folder picker answers with the queue folder, the export suite's arrangement. */
async function answerPickerWith(directory: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, directory);
}

/** Drops a task folder the way a person or Jacurutu would. */
function drop(id: string, brief: string): void {
  mkdirSync(join(queueFolder, 'inbox', id), { recursive: true });
  writeFileSync(join(queueFolder, 'inbox', id, 'brief.brief'), brief, 'utf8');
}

const task = (id: string) => page.locator(`.queue__task[data-task="${id}"]`);

/** Waits for a task's row to say `status`, and reports what it said instead if it never does. */
async function waitForStatus(id: string, status: string, timeout = 60_000): Promise<void> {
  try {
    await page.waitForSelector(`.queue__task[data-task="${id}"][data-status="${status}"]`, {
      timeout,
    });
  } catch (cause) {
    const rows = await page.$$eval('.queue__task', (found) =>
      found.map((row) => `${row.getAttribute('data-task')}=${row.getAttribute('data-status')}`),
    );
    throw new Error(`task '${id}' never became '${status}'; the panel shows [${rows.join(', ')}]`, {
      cause,
    });
  }
}

/** Runs a command through the bar, and fails loudly if the bar refused it (TYTO-154). */
async function run(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-queue-e2e-'));
  queueFolder = join(scratch, 'fila');
  mkdirSync(queueFolder);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the local queue panel', () => {
  it('is closed on a first launch', async () => {
    expect(await page.locator('tyto-queue-panel').count()).toBe(0);
  });

  it('opens from the File menu, inside the window', async () => {
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('queue.show')?.click();
    });
    await page.waitForSelector('tyto-queue-panel .queue__choose');

    // Inside the window and big enough to read. jsdom answers neither.
    const box = await page.locator('tyto-queue-panel').boundingBox();
    const size =
      page.viewportSize() ??
      (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
    // The editor is still there beside it: a dock panel, not a modal.
    expect(await page.locator('#editor .cm-content').isVisible()).toBe(true);
  });

  it('points at a folder chosen in the picker, and makes its inbox', async () => {
    await answerPickerWith(queueFolder);
    await page.click('tyto-queue-panel .queue__choose');
    await page.waitForSelector('tyto-queue-panel .queue__path');

    expect(await page.textContent('tyto-queue-panel .queue__path')).toBe(
      join(queueFolder, 'inbox'),
    );
    expect(existsSync(join(queueFolder, 'inbox'))).toBe(true);
    // Written down, so the next launch opens on the same queue.
    const settings = JSON.parse(
      readFileSync(join(scratch, 'user-data', 'settings.json'), 'utf8'),
    ) as {
      queueFolder: string;
    };
    expect(settings.queueFolder).toBe(queueFolder);
  });

  it('shows a folder dropped in with auto-run off, and does not render it', async () => {
    drop('espera', GOOD);
    await waitForStatus('espera', 'pending', 10_000);

    await page.waitForTimeout(1500);
    expect(await task('espera').getAttribute('data-status')).toBe('pending');
    expect(existsSync(join(queueFolder, 'outbox', 'espera'))).toBe(false);
  });

  it('renders a folder dropped in while auto-run is on, and moves it to done/', async () => {
    await page.check('tyto-queue-panel .queue__auto-run');
    drop('nova', GOOD);

    await waitForStatus('nova', 'done');
    // The one left waiting before auto-run came on is rendered by the same sweep.
    await waitForStatus('espera', 'done');

    const out = join(queueFolder, 'outbox', 'nova', 'out');
    expect(readdirSync(out).filter((name) => name.endsWith('.png')).length).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'))).toMatchObject({
      status: 'ok',
    });
    expect(existsSync(join(queueFolder, 'done', 'nova', 'brief.brief'))).toBe(true);
    expect(existsSync(join(queueFolder, 'inbox', 'nova'))).toBe(false);
  });

  it('shows a failed task its diagnostics, and leaves it in the inbox', async () => {
    drop('quebrada', BROKEN);

    await waitForStatus('quebrada', 'error');

    expect(await task('quebrada').locator('.queue__code').allTextContents()).toContain(
      'E_UNKNOWN_TEMPLATE',
    );
    expect(existsSync(join(queueFolder, 'inbox', 'quebrada', 'brief.brief'))).toBe(true);
  });

  it('opens the failed brief in the editor, where it is fixed and saved', async () => {
    await task('quebrada').locator('.queue__open-brief').click();
    // Named after the task, so it can be told apart from any other task's `brief.brief`.
    await page.waitForSelector('.tabs__tab:has-text("quebrada · brief.brief")');

    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(GOOD);
    await run('editor.save');

    await expect
      .poll(() => readFileSync(join(queueFolder, 'inbox', 'quebrada', 'brief.brief'), 'utf8'))
      .toBe(GOOD);
  });

  it('runs the fixed task again from the panel, and it finishes', async () => {
    await task('quebrada').locator('.queue__run').click();

    await waitForStatus('quebrada', 'done');
    expect(existsSync(join(queueFolder, 'done', 'quebrada', 'brief.brief'))).toBe(true);

    // The picture a person would see, kept for looking at: the suite writes it and the card
    // was not called done until somebody had.
    await page.screenshot({ path: join(tmpdir(), 'tyto-queue-panel.png') });
  });

  it('keeps saving the fixed brief after it has moved to done/', async () => {
    // The card's flow one step later: the tab the brief was fixed in followed it out of
    // `inbox/`, so a further edit is saved where the task now lives, not into a folder that is
    // gone.
    const moved = join(queueFolder, 'done', 'quebrada', 'brief.brief');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' depois');
    await run('editor.save');

    await expect.poll(() => readFileSync(moved, 'utf8')).toBe(`${GOOD} depois`);
    // Nothing was put back in the inbox, which would have queued the task a second time.
    expect(existsSync(join(queueFolder, 'inbox', 'quebrada'))).toBe(false);
    expect(await page.locator('.tabs__tab', { hasText: 'quebrada · brief.brief' }).count()).toBe(1);
  });

  it('tries again a task that lost a slide, and out/ keeps only the new ones (TYTO-199)', async () => {
    // Auto-run off, so the second run is the button and not a sweep.
    await page.uncheck('tyto-queue-panel .queue__auto-run');
    const id = 'encolhe';
    const brief = join(queueFolder, 'inbox', id, 'brief.brief');
    const out = join(queueFolder, 'outbox', id, 'out');
    const pngs = () =>
      readdirSync(out)
        .filter((name) => name.endsWith('.png'))
        .sort();
    const listed = () =>
      JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')) as {
        status: string;
        artifacts: { name: string }[];
        diagnostics: { code: string }[];
      };

    // A clean run leaves for done/, and only a failed one offers Try again. A non-empty folder
    // where the task's done/ folder would go makes the move fail after the render — ENOTEMPTY
    // on Linux, EPERM on Windows, which replaces a plain file there without complaint — and
    // that is the failure queue.ts reports as "rendered, but could not be moved". With no
    // `brief.brief` in it, the done/ listing does not take it for a task.
    mkdirSync(join(queueFolder, 'done', id), { recursive: true });
    writeFileSync(join(queueFolder, 'done', id, 'in-the-way.txt'), 'in the way', 'utf8');
    drop(id, agenda(4));
    await waitForStatus(id, 'pending', 10_000);
    await task(id).locator('.queue__run').click();
    await waitForStatus(id, 'error');
    expect(pngs()).toHaveLength(4);

    rmSync(join(queueFolder, 'done', id), { recursive: true });
    writeFileSync(brief, agenda(3), 'utf8');
    await expect
      .poll(async () => (await task(id).locator('.queue__run').textContent())?.trim())
      .toBe('Try again');
    await task(id).locator('.queue__run').click();
    await waitForStatus(id, 'done');

    const result = listed();
    expect(result.status).toBe('ok');
    expect(result.artifacts).toHaveLength(3);
    expect(pngs()).toEqual(result.artifacts.map((artifact) => artifact.name).sort());
    expect(result.diagnostics.map((item) => item.code)).toContain('W_LEFTOVER_REMOVED');
    await page.screenshot({ path: join(tmpdir(), 'tyto-queue-retry.png') });
  });
});
