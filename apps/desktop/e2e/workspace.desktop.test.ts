import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { openPreviewBeside, previewSrcdoc } from './preview-pane.js';

/**
 * A workspace folder in the real window (TYTO-278, ADR 0113): File ▸ Open Folder through main's
 * picker, a brief inside it drawing a template and an image from the folders its
 * `.tyto/project.json` names, the export dialog pointing at its output folder, a key that
 * leads outside listed in the problems panel, and the folder back after a relaunch.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`. The picker is answered from main, never by the
 * window: no channel takes a path.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** A solid 8×8 PNG, built here so no binary is checked in (as `assets.desktop.test.ts`). */
function solidPng(rgb: readonly [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0);
  header.writeUInt32BE(8, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(8 * 3, Buffer.from(rgb))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LOGO = solidPng([30, 90, 200]);

let scratch: string;
let work: string;
let app: ElectronApplication | undefined;
let window: Page;

async function launch(): Promise<void> {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');
}

/** Answers main's next pickers: a folder for a folder picker, a file for a file picker. */
async function answerPickers(paths: { file?: string; directory?: string }): Promise<void> {
  await app?.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = (options?: unknown) => {
        const properties = (options as { properties?: string[] } | undefined)?.properties ?? [];
        const wanted = properties.includes('openDirectory') ? chosen.directory : chosen.file;
        return Promise.resolve(
          wanted === null
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [wanted] },
        );
      };
    },
    { file: paths.file ?? null, directory: paths.directory ?? null },
  );
}

async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const problemsText = async (): Promise<string> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map((row) => row.textContent).join('\n'),
  );

async function openBrief(path: string, title: string): Promise<void> {
  await answerPickers({ file: path });
  await run('editor.open');
  await expect.poll(() => previewSrcdoc(window), { timeout: 15_000 }).toContain(title);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-workspace-e2e-'));
  work = join(scratch, 'promo');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  mkdirSync(join(work, 'art'), { recursive: true });
  mkdirSync(join(work, 'briefs'), { recursive: true });
  writeFileSync(join(work, 'art', 'logo.png'), LOGO);
  cpSync(
    join(here, '__fixtures__', 'templates', 'guarda-teste'),
    join(work, 'tpl', 'guarda-teste'),
    { recursive: true },
  );
  // Restricted, as every folder starts: `fonts` leads outside and is left out, the rest holds.
  writeFileSync(
    join(work, '.tyto', 'project.json'),
    '{\n  "templates": ["tpl"],\n  "assets": ["art"],\n  "fonts": ["../elsewhere"],\n  "output": "exports"\n}\n',
  );
  writeFileSync(
    join(work, 'briefs', 'logo.brief'),
    [
      '---',
      'template: promo-curso',
      'formats: [grid-1x1]',
      'imagem: logo.png',
      '---',
      '::titulo',
      '  Da pasta do projeto',
    ].join('\n'),
  );
  writeFileSync(
    join(work, 'briefs', 'guarda.brief'),
    [
      '---',
      'template: guarda-teste',
      'formats: [grid-1x1]',
      '---',
      '::titulo',
      '  Template do projeto',
      '::lamina',
      '  Um',
    ].join('\n'),
  );
  await launch();
  await openPreviewBeside(window);
});

afterAll(async () => {
  if (app !== undefined) await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a workspace folder in the window (TYTO-278)', () => {
  it('opens through main, and a brief inside draws from the declared folders', async () => {
    await answerPickers({ directory: work });
    await run('workspace.openFolder');
    await expect.poll(problemsText, { timeout: 10_000 }).toContain('W_PROJECT_PATH_OUTSIDE');
    expect(await problemsText()).toContain('project.json:4:');

    await openBrief(join(work, 'briefs', 'logo.brief'), 'Da pasta do projeto');
    expect(await previewSrcdoc(window)).toContain(LOGO.toString('base64'));
    // The titles name the folder between the file and the app (Rafael, 2026-10-21).
    expect(await window.title()).toBe('logo.brief — promo — Tyto');

    await openBrief(join(work, 'briefs', 'guarda.brief'), 'Template do projeto');
    expect(await problemsText()).not.toContain('E_UNKNOWN_TEMPLATE');
  }, 60_000);

  it("points the export dialog at the folder's output folder", async () => {
    await run('file.export');
    await window.locator('.export__panel').waitFor({ state: 'visible' });
    await window.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="export-directory"]')?.textContent?.trim() ===
        expected,
      join(work, 'exports'),
    );
    await window.keyboard.press('Escape');
  }, 30_000);

  it('comes back after a relaunch, and goes when it is closed', async () => {
    await closeApp(app!);
    app = undefined;
    await launch();
    await openPreviewBeside(window);
    await expect.poll(problemsText, { timeout: 15_000 }).toContain('W_PROJECT_PATH_OUTSIDE');
    await expect
      .poll(() => previewSrcdoc(window), { timeout: 15_000 })
      .toContain('Template do projeto');

    await run('workspace.closeFolder');
    await expect.poll(problemsText, { timeout: 10_000 }).not.toContain('W_PROJECT_PATH_OUTSIDE');
    await expect.poll(problemsText, { timeout: 10_000 }).toContain('E_UNKNOWN_TEMPLATE');
  }, 60_000);
});

describe('trusting a folder from the window (TYTO-278, ADR 0111)', () => {
  const SHARED = solidPng([200, 120, 30]);
  const bannerShown = async (): Promise<boolean> =>
    window.evaluate(() => document.getElementById('workspace-banner')?.hidden === false);

  it('shows the banner, and Trust applies the withheld folder at once', async () => {
    const team = join(scratch, 'equipe');
    mkdirSync(join(team, '.tyto'), { recursive: true });
    mkdirSync(join(team, 'briefs'), { recursive: true });
    mkdirSync(join(scratch, 'shared-art'), { recursive: true });
    writeFileSync(join(scratch, 'shared-art', 'shared.png'), SHARED);
    writeFileSync(join(team, '.tyto', 'project.json'), '{ "assets": ["../shared-art"] }');
    writeFileSync(
      join(team, 'briefs', 'shared.brief'),
      [
        '---',
        'template: promo-curso',
        'formats: [grid-1x1]',
        'imagem: shared.png',
        '---',
        '::titulo',
        '  Arte da equipe',
      ].join('\n'),
    );

    await answerPickers({ directory: team });
    await run('workspace.openFolder');
    await expect.poll(bannerShown, { timeout: 10_000 }).toBe(true);
    await openBrief(join(team, 'briefs', 'shared.brief'), 'Arte da equipe');
    expect(await previewSrcdoc(window)).not.toContain(SHARED.toString('base64'));

    await window.locator('.workspace-banner__trust').click();
    await expect.poll(bannerShown, { timeout: 10_000 }).toBe(false);
    await expect
      .poll(() => previewSrcdoc(window), { timeout: 15_000 })
      .toContain(SHARED.toString('base64'));
    expect(readFileSync(join(scratch, 'tyto-home', 'trust.json'), 'utf8')).toContain('equipe');
  }, 60_000);

  it('takes the trust back from Manage Trust, saying it applies on the next open', async () => {
    await run('workspace.manageTrust');
    await window.locator('.trust__panel').waitFor({ state: 'visible' });
    await window.locator('.trust__revoke').click();
    await window.waitForFunction(
      () => document.querySelector('.trust__state')?.getAttribute('data-trust') === 'revoked',
    );
    // Still drawn as trusted until the folder is opened again.
    expect(await bannerShown()).toBe(false);
    expect(readFileSync(join(scratch, 'tyto-home', 'trust.json'), 'utf8')).not.toContain('equipe');
    await window.locator('.trust__close').click();
  }, 30_000);
});

describe('a work profile in the window (TYTO-347, ADR 0114)', () => {
  const PROFILE_ART = solidPng([20, 160, 90]);
  const TEAM_ART = solidPng([160, 20, 120]);
  const profileLineShown = async (): Promise<boolean> =>
    window.evaluate(
      () =>
        document.getElementById('workspace-banner')?.hidden === false &&
        document.querySelector<HTMLElement>('.workspace-banner__line[data-source="profile"]')
          ?.hidden === false,
    );
  const projectLine = async (key: string): Promise<string> =>
    window.evaluate(
      (wanted) =>
        document
          .querySelector(
            `tyto-project-panel .project__place[data-key="${wanted}"] .project__origin`,
          )
          ?.textContent?.trim() ?? '',
      key,
    );

  function brief(folder: string, image: string, title: string): string {
    mkdirSync(join(folder, 'briefs'), { recursive: true });
    const path = join(folder, 'briefs', `${image}.brief`);
    writeFileSync(
      path,
      [
        '---',
        'template: promo-curso',
        'formats: [grid-1x1]',
        `imagem: ${image}.png`,
        '---',
        '::titulo',
        `  ${title}`,
      ].join('\n'),
    );
    return path;
  }

  it('draws from a named profile, and the Project panel says where each place came from', async () => {
    const profile = join(scratch, 'tyto-home', 'profiles', 'saude');
    mkdirSync(join(profile, 'art'), { recursive: true });
    writeFileSync(join(profile, 'art', 'perfil.png'), PROFILE_ART);
    writeFileSync(join(profile, 'profile.json'), '{ "assets": ["art"], "output": "exports" }');
    const campaign = join(scratch, 'campanha');
    mkdirSync(join(campaign, '.tyto'), { recursive: true });
    writeFileSync(
      join(campaign, '.tyto', 'project.json'),
      '{ "profile": "saude", "output": "out" }',
    );
    const path = brief(campaign, 'perfil', 'Do perfil');

    await answerPickers({ directory: campaign });
    await run('workspace.openFolder');
    await openBrief(path, 'Do perfil');
    expect(await previewSrcdoc(window)).toContain(PROFILE_ART.toString('base64'));

    await run('workspace.showProject');
    await window.locator('tyto-project-panel .project__places').waitFor({ state: 'visible' });
    expect(await projectLine('assets')).toBe('profile saude');
    expect(await projectLine('output')).toBe('this folder');
    expect(await projectLine('fonts')).toBe('not set');
  }, 60_000);

  it('names a restricted shared profile on its own line, and Trust this profile applies it', async () => {
    mkdirSync(join(scratch, 'team-art'), { recursive: true });
    writeFileSync(join(scratch, 'team-art', 'equipe.png'), TEAM_ART);
    const shop = join(scratch, 'loja');
    mkdirSync(join(shop, '.tyto'), { recursive: true });
    mkdirSync(join(shop, 'team'), { recursive: true });
    writeFileSync(join(shop, 'team', 'saude.json'), '{ "assets": ["../../team-art"] }');
    writeFileSync(join(shop, '.tyto', 'project.json'), '{ "profile": "team/saude.json" }');
    const path = brief(shop, 'equipe', 'Da equipe');

    await answerPickers({ directory: shop });
    await run('workspace.openFolder');
    await expect.poll(profileLineShown, { timeout: 10_000 }).toBe(true);
    await openBrief(path, 'Da equipe');
    expect(await previewSrcdoc(window)).not.toContain(TEAM_ART.toString('base64'));
    expect(await problemsText()).toContain(`${join('team', 'saude.json')}:1:`);

    await window.locator('.workspace-banner__trust-profile').click();
    await expect.poll(profileLineShown, { timeout: 10_000 }).toBe(false);
    await expect
      .poll(() => previewSrcdoc(window), { timeout: 15_000 })
      .toContain(TEAM_ART.toString('base64'));
    const trusted = readFileSync(join(scratch, 'tyto-home', 'trust.json'), 'utf8');
    expect(trusted).toContain('saude.json');
    // The folder itself was not trusted along with it (ADR 0111).
    expect(trusted).not.toContain('"path": ' + JSON.stringify(shop));
  }, 60_000);
});

describe('the recent folders in the title bar (TYTO-487)', () => {
  it('switches the workspace to a folder chosen from the popover, by keys alone', async () => {
    const button = window.locator('.title-bar__project');
    // Four folders were opened above; the last, `loja`, is open now.
    await expect.poll(() => button.textContent(), { timeout: 10_000 }).toBe('loja');

    await button.click();
    await window.locator('.recent-folders__search').waitFor({ state: 'visible' });
    await window.keyboard.type('promo');
    await window.keyboard.press('Enter');

    await expect.poll(() => button.textContent(), { timeout: 10_000 }).toBe('promo');
    await expect.poll(problemsText, { timeout: 10_000 }).toContain('W_PROJECT_PATH_OUTSIDE');
  }, 30_000);
});
