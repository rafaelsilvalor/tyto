import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

/**
 * A delivery folder's badge in the real window (TYTO-757, ADR 0215): a trusted folder whose
 * delivery owes one `feed` and one `story` shows the delivery in progress; two PNGs dropped at
 * its root turn it ready within the watcher's settle, and a wrong-size one turns it incomplete,
 * the file and the size it should be in the badge's tooltip.
 *
 * The PNGs are headers only: the check reads the size from the header and nothing else. Its own
 * `--user-data-dir` and `TYTO_HOME`, the folder trusted through `tyto trust add` before launch;
 * one launch, inside the 60 s budget (ADR 0105). With `TYTO_DELIVERY_CHECK_SHOTS` set to a folder
 * it leaves two pictures of the Explorer at the same wait: the ready badge, and a folder with no
 * record beside it as the control.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}
const shots = process.env['TYTO_DELIVERY_CHECK_SHOTS'];

let scratch: string;
let work: string;
let app: ElectronApplication | undefined;
let page: Page;

const quiet = { out: () => {}, err: () => {} };

/** A PNG header that states `width` by `height`: all the check reads of it. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  bytes.writeUInt32BE(0x89_50_4e_47, 0);
  bytes.writeUInt32BE(0x0d_0a_1a_0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const command = (commandId: string): Promise<boolean> =>
  page.evaluate(
    (id) =>
      (
        document.querySelector('tyto-command-bar') as { run?: (id: string) => boolean } | null
      )?.run?.(id) ?? false,
    commandId,
  );

/** The badge on a row as drawn: its state and its tooltip, or `null` when it has none. */
const badgeOf = (name: string) =>
  page.evaluate((folder) => {
    const badge = document.querySelector<HTMLElement>(
      `.explorer__row[data-name="${folder}"] .explorer__delivery`,
    );
    return badge === null ? null : { check: badge.dataset['deliveryCheck'], title: badge.title };
  }, name);

/** Waits until the badge on `name` says `check`. */
const waitForCheck = (name: string, check: string) =>
  page.waitForFunction(
    ([folder, state]) =>
      document
        .querySelector<HTMLElement>(`.explorer__row[data-name="${folder}"] .explorer__delivery`)
        ?.getAttribute('data-delivery-check') === state,
    [name, check] as const,
    { timeout: 15_000 },
  );

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-delivery-check-'));
  const home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  writeFileSync(
    join(work, '.tyto', 'project.json'),
    JSON.stringify({
      delivery: { parent: 'entregas', sizes: { feed: '1080x1350', story: '1080x1920' } },
    }),
  );
  const delivery = join(work, 'entregas', 'mca-1');
  mkdirSync(join(delivery, 'editaveis'), { recursive: true });
  writeFileSync(
    join(delivery, 'editaveis', 'delivery.json'),
    JSON.stringify({
      version: 1,
      key: 'MCA-1',
      formats: [
        { format: 'feed', count: 1 },
        { format: 'story', count: 1 },
      ],
    }),
  );
  writeFileSync(join(delivery, 'editaveis', 'arte.psd'), 'psd');
  mkdirSync(join(work, 'entregas', 'rascunho'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const trusted = await run(['trust', 'add', work], {
    version: '0.0.0-e2e',
    cwd: work,
    home,
    console: quiet,
    confirm: () => Promise.resolve(true),
    rasterizer: () => {
      throw new Error('no render here');
    },
  });
  expect(trusted).toBe(0);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, work);
  await switchingFolder(page, () => command('workspace.openFolder'));
}, 60_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("a delivery folder's badge (TYTO-757)", () => {
  it('shows a delivery with nothing exported in progress, and a folder with no record bare', async () => {
    await page.locator('.explorer__row[data-name="entregas"]').click({ timeout: 15_000 });
    await waitForCheck('mca-1', 'in-progress');
    expect(await badgeOf('mca-1')).toEqual({
      check: 'in-progress',
      title: 'Delivery in progress',
    });
    expect(await badgeOf('rascunho')).toBeNull();
  }, 20_000);

  it('turns ready when the two exports land at their sizes', async () => {
    const delivery = join(work, 'entregas', 'mca-1');
    writeFileSync(join(delivery, 'feed.png'), png(1080, 1350));
    writeFileSync(join(delivery, 'story.png'), png(1080, 1920));
    await waitForCheck('mca-1', 'ready');
    expect(await badgeOf('mca-1')).toEqual({ check: 'ready', title: 'Delivery ready to check' });

    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      const explorer = page.locator('tyto-explorer-panel');
      await explorer.screenshot({ path: join(shots, 'delivery-ready.png') });
      await page
        .locator('.explorer__row[data-name="rascunho"]')
        .screenshot({ path: join(shots, 'control-no-record.png') });
      await page
        .locator('.explorer__row[data-name="mca-1"]')
        .screenshot({ path: join(shots, 'delivery-ready-row.png') });
    }
  }, 20_000);

  it('turns incomplete on a wrong-size export, naming the file and the size it should be', async () => {
    writeFileSync(join(work, 'entregas', 'mca-1', 'feed.png'), png(1080, 1080));
    await waitForCheck('mca-1', 'incomplete');
    const badge = await badgeOf('mca-1');
    expect(badge?.title.split('\n')).toEqual([
      'Delivery incomplete',
      "'feed' has 0 of 1 at 1080×1350",
      "'feed.png' is 1080×1080, and the record owes feed 1080×1350, story 1080×1920",
    ]);

    if (shots !== undefined) {
      await page
        .locator('.explorer__row[data-name="mca-1"]')
        .screenshot({ path: join(shots, 'delivery-incomplete-row.png') });
    }
  }, 20_000);
});
