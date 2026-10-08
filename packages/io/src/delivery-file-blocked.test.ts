import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type DeliveryOutput, fsDeliveryOutput, fsTaskOutput, placeAtomic } from './fs-outbox.js';
import { renderResult } from './result.js';

/**
 * TYTO-243, the mirror of TYTO-129: a **folder** holding a name the output writes as a file is
 * the caller's to fix, and is answered with `E_OUTPUT_FILE_BLOCKED`. Windows says `EPERM` for
 * it, the same code a file held open by another program gives, and that one must stay a throw.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-io-file-blocked-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const BRIEF = new TextEncoder().encode(
  '---\ntemplate: agenda-semana\nimagem: ./marca/selo.png\nfundo: ./marca/fundo.png\n---\n',
);

const emptyResult = () =>
  renderResult({
    cancelled: false,
    planned: 0,
    artifacts: [],
    diagnostics: [],
    version: '0.0.0-test',
    templates: [],
  });

const sentence = (path: string): string =>
  `'${path}' is a folder, and Tyto needs to write a file with that name. Rename or move the folder, or write somewhere else.`;

async function openDelivery(picked: string): Promise<DeliveryOutput> {
  const opened = await fsDeliveryOutput(picked, {
    name: 'agenda',
    brief: BRIEF,
    folder: 'destination',
  });
  if (!opened.ok) throw new Error(`expected the delivery to open: ${opened.error[0]?.message}`);
  return opened.value;
}

/** A folder at `path` with a file inside, so a test can tell it was left alone. */
async function holdWithFolder(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'dentro.txt'), 'kept');
}

async function expectUntouched(path: string): Promise<void> {
  expect(await readFile(join(path, 'dentro.txt'), 'utf8')).toBe('kept');
}

describe('a folder where the delivery writes a file', () => {
  it('refuses to open when a folder holds the copied brief, and writes nothing beside it', async () => {
    const picked = join(workspace, 'escolhida');
    const held = join(picked, 'editaveis', 'agenda.brief');
    await holdWithFolder(held);

    const opened = await fsDeliveryOutput(picked, {
      name: 'agenda',
      brief: BRIEF,
      folder: 'destination',
    });

    if (opened.ok) throw new Error('expected the delivery to be refused');
    expect(opened.error.map((item) => [item.code, item.severity, item.message])).toEqual([
      ['E_OUTPUT_FILE_BLOCKED', 'error', sentence(held)],
    ]);
    await expectUntouched(held);
    // No `.part` left pretending to be output.
    expect(await readdir(join(picked, 'editaveis'))).toEqual(['agenda.brief']);
  });

  it('answers a folder holding template.txt', async () => {
    const picked = join(workspace, 'escolhida');
    const held = join(picked, 'editaveis', 'template.txt');
    await holdWithFolder(held);
    const output = await openDelivery(picked);

    const answered = await output.describeTemplate({ name: 'agenda-semana', version: '1.0.0' });

    expect(answered.map((item) => [item.code, item.message])).toEqual([
      ['E_OUTPUT_FILE_BLOCKED', sentence(held)],
    ]);
    await expectUntouched(held);
  });

  it('answers a folder holding result.json, after the artwork is written', async () => {
    const picked = join(workspace, 'escolhida');
    const held = join(picked, 'editaveis', 'result.json');
    await holdWithFolder(held);
    const output = await openDelivery(picked);

    const answered = await output.finish(emptyResult());

    expect(answered.map((item) => [item.code, item.message])).toEqual([
      ['E_OUTPUT_FILE_BLOCKED', sentence(held)],
    ]);
    await expectUntouched(held);
  });

  it('answers a folder holding result.json under --out too, which shares the writer', async () => {
    const out = join(workspace, 'out');
    const held = join(out, 'result.json');
    await holdWithFolder(held);
    const output = await fsTaskOutput(out);

    const answered = await output.finish(emptyResult());

    expect(answered.map((item) => item.code)).toEqual(['E_OUTPUT_FILE_BLOCKED']);
  });

  it('rejects an artwork write with the sentence, which the job turns into E_OUTPUT_WRITE', async () => {
    const picked = join(workspace, 'escolhida');
    const held = join(picked, 'grid-01.svg');
    await holdWithFolder(held);
    const output = await openDelivery(picked);

    const write = output.write({
      name: 'grid-01.svg',
      artwork: 'a',
      format: 'grid',
      kind: 'svg',
      mime: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg/>'),
    });

    // Without its full stop: E_OUTPUT_WRITE's own sentence ends with one.
    await expect(write).rejects.toThrow(sentence(held).replace(/\.$/, ''));
    await expectUntouched(held);
  });

  it('copies the images it can, and leaves the held one pointed at its own path', async () => {
    const briefs = join(workspace, 'briefs');
    await mkdir(briefs);
    await writeFile(join(briefs, 'selo.png'), 'seal bytes');
    await writeFile(join(briefs, 'fundo.png'), 'background bytes');
    const picked = join(workspace, 'escolhida');
    const held = join(picked, 'assets', 'selo.png');
    await holdWithFolder(held);
    const output = await openDelivery(picked);

    const answered = await output.deliverAssets([
      { reference: './marca/selo.png', path: join(briefs, 'selo.png') },
      { reference: './marca/fundo.png', path: join(briefs, 'fundo.png') },
    ]);

    expect(answered.map((item) => [item.code, item.severity, item.message])).toEqual([
      ['E_OUTPUT_FILE_BLOCKED', 'error', sentence(held)],
    ]);
    await expectUntouched(held);
    expect(await readFile(join(picked, 'assets', 'fundo.png'), 'utf8')).toBe('background bytes');
    // The copied brief points at what reached `assets/`, and does not claim `selo.png` did.
    const copied = await readFile(join(picked, 'editaveis', 'agenda.brief'), 'utf8');
    expect(copied).toContain('fundo: fundo.png\n');
    expect(copied).toContain('imagem: ./marca/selo.png\n');
  });
});

describe('placeAtomic', () => {
  const locked = (): NodeJS.ErrnoException =>
    Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

  it('rethrows EPERM onto a file — what a file another program holds open gives', async () => {
    // A seam: Node opens files sharing delete, so it cannot hold one the way Explorer or an
    // editor does. The real lock was measured by hand for the PR, with FileShare.None.
    const target = join(workspace, 'aberto.png');
    await writeFile(target, 'held by somebody');
    const refused = locked();

    await expect(
      placeAtomic(
        target,
        (temporary) => writeFile(temporary, 'new'),
        () => Promise.reject(refused),
      ),
    ).rejects.toBe(refused);
    expect(await readFile(target, 'utf8')).toBe('held by somebody');
    expect(await readdir(workspace)).toEqual(['aberto.png']);
  });

  it('rethrows when nothing is at the name — a refusal that is not about the name', async () => {
    const refused = Object.assign(new Error('ENOSPC: no space left on device, write'), {
      code: 'ENOSPC',
    });

    await expect(
      placeAtomic(join(workspace, 'novo.png'), () => Promise.reject(refused)),
    ).rejects.toBe(refused);
  });

  it('answers the same EPERM onto a folder, because it looks rather than reading the code', async () => {
    const target = join(workspace, 'pasta.png');
    await mkdir(target);

    const answered = await placeAtomic(
      target,
      (temporary) => writeFile(temporary, 'new'),
      () => Promise.reject(locked()),
    );

    expect(answered?.code).toBe('E_OUTPUT_FILE_BLOCKED');
  });
});
