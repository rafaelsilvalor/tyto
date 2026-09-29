import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rewriteFrontmatterValues } from './delivery-brief.js';
import { briefAssetResolver, recordingAssetResolver } from './file-assets.js';
import { fsDeliveryOutput } from './fs-outbox.js';

/**
 * ADR 0057: a delivery carries its brief in `editaveis/` and the images the brief used in
 * `assets/`, and the copied brief still renders from where it now sits.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-delivery-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const BRIEF = [
  '---',
  'template: agenda-semana',
  'selo: ./fotos/selo.png',
  "imagem: 'calendario.png'",
  '---',
  '// o selo.png e o calendario.png entram no cabeçalho',
  '',
  '::titulo',
  '  selo.png calendario.png ./fotos/selo.png',
  '',
].join('\n');

describe('rewriteFrontmatterValues', () => {
  const renames = new Map([
    ['./fotos/selo.png', 'selo.png'],
    ['calendario.png', 'calendario.png'],
  ]);

  it('rewrites only frontmatter values, leaving comments and the body that name the same files', () => {
    const rewritten = rewriteFrontmatterValues(BRIEF, renames);

    expect(rewritten.split('\n').slice(0, 5)).toEqual([
      '---',
      'template: agenda-semana',
      'selo: selo.png',
      "imagem: 'calendario.png'",
      '---',
    ]);
    // Everything after the closing fence is byte for byte what the author wrote.
    expect(rewritten.slice(rewritten.indexOf('// o selo'))).toBe(
      BRIEF.slice(BRIEF.indexOf('// o selo')),
    );
  });

  it('keeps the line endings the author wrote', () => {
    const crlf = BRIEF.replace(/\n/gu, '\r\n');

    expect(rewriteFrontmatterValues(crlf, renames)).toContain('selo: selo.png\r\n');
    expect(
      rewriteFrontmatterValues(crlf, renames).includes('\n') &&
        !/[^\r]\n/u.test(rewriteFrontmatterValues(crlf, renames)),
    ).toBe(true);
  });

  it('changes nothing in a brief without frontmatter', () => {
    const bodyOnly = '::titulo\n  selo.png\n';
    expect(rewriteFrontmatterValues(bodyOnly, renames)).toBe(bodyOnly);
  });
});

describe('briefAssetResolver in a delivery', () => {
  async function delivery(folderName: string) {
    const root = join(workspace, 'entrega');
    const briefDirectory = join(root, folderName);
    await mkdir(briefDirectory, { recursive: true });
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'selo.png'), 'the delivery seal');
    return { root, briefDirectory };
  }

  it('reads the delivery assets/ for a brief in editaveis/', async () => {
    const { briefDirectory } = await delivery('editaveis');

    const asset = await briefAssetResolver({ briefDirectory }).resolve('selo.png');

    expect(asset?.path).toBe(join(workspace, 'entrega', 'assets', 'selo.png'));
  });

  it('never reads ../assets for a brief in a folder not named editaveis', async () => {
    const { briefDirectory } = await delivery('rascunhos');
    const resolver = briefAssetResolver({ briefDirectory });

    expect(await resolver.resolve('selo.png')).toBeUndefined();
    expect(resolver.searched).toEqual([briefDirectory, join(briefDirectory, 'assets')]);
  });

  it('names all three folders it searched for a brief in editaveis/', async () => {
    const { root, briefDirectory } = await delivery('editaveis');

    expect(briefAssetResolver({ briefDirectory }).searched).toEqual([
      briefDirectory,
      join(briefDirectory, 'assets'),
      join(root, 'assets'),
    ]);
  });

  it('still refuses a path that climbs out, from editaveis/ and from the delivery assets/', async () => {
    const { root, briefDirectory } = await delivery('editaveis');
    await writeFile(join(workspace, 'segredo.txt'), 'outside the delivery');
    const resolver = briefAssetResolver({ briefDirectory });

    // Climbs out of editaveis/: refused there and not retried in the other folders.
    expect(await resolver.resolve('../assets/selo.png')).toBeUndefined();
    // Climbs out of the delivery assets/ towards a real file beside the delivery.
    expect(await resolver.resolve('../segredo.txt')).toBeUndefined();
    expect(await resolver.resolve(join('..', '..', 'segredo.txt'))).toBeUndefined();
    expect(root).toBeDefined();
  });
});

describe('fsDeliveryOutput.deliverAssets', () => {
  async function sourceFolder() {
    const briefs = join(workspace, 'briefs');
    await mkdir(join(briefs, 'fotos'), { recursive: true });
    await mkdir(join(briefs, 'assets'), { recursive: true });
    await writeFile(join(briefs, 'fotos', 'selo.png'), 'seal bytes');
    await writeFile(join(briefs, 'assets', 'calendario.png'), 'calendar bytes');
    return briefs;
  }

  async function resolvedFrom(briefs: string) {
    const recorder = recordingAssetResolver(briefAssetResolver({ briefDirectory: briefs }));
    await recorder.resolver.resolve('./fotos/selo.png');
    await recorder.resolver.resolve('calendario.png');
    return recorder.delivered();
  }

  it('copies the images into assets/ and points the copied brief at them', async () => {
    const briefs = await sourceFolder();
    const output = await fsDeliveryOutput(join(workspace, 'entrega'), {
      name: 'agenda',
      brief: new TextEncoder().encode(BRIEF),
      folder: 'destination',
    });

    const warnings = await output.deliverAssets(await resolvedFrom(briefs));

    const root = join(workspace, 'entrega');
    expect(warnings).toEqual([]);
    expect((await readdir(join(root, 'assets'))).sort()).toEqual(['calendario.png', 'selo.png']);
    const copied = await readFile(join(root, 'editaveis', 'agenda.brief'), 'utf8');
    expect(copied).toContain('selo: selo.png\n');
    // And the copy renders from where it now sits: every path resolves through the
    // delivery's assets/, to the delivered bytes.
    const resolver = briefAssetResolver({ briefDirectory: join(root, 'editaveis') });
    expect((await resolver.resolve('selo.png'))?.path).toBe(join(root, 'assets', 'selo.png'));
    expect((await resolver.resolve('calendario.png'))?.path).toBe(
      join(root, 'assets', 'calendario.png'),
    );
  });

  it('writes into the named subfolder by default, as tyto render --folder does', async () => {
    const briefs = await sourceFolder();
    const output = await fsDeliveryOutput(join(workspace, 'entregas'), {
      name: 'agenda',
      brief: new TextEncoder().encode(BRIEF),
    });

    await output.deliverAssets(await resolvedFrom(briefs));

    expect(await readdir(join(workspace, 'entregas', 'agenda', 'assets'))).toHaveLength(2);
  });

  it('suffixes a second file that shares a name, and copies one file named twice once', async () => {
    const briefs = await sourceFolder();
    await writeFile(join(briefs, 'selo.png'), 'another seal');
    const output = await fsDeliveryOutput(join(workspace, 'entrega'), {
      name: 'agenda',
      brief: new TextEncoder().encode(
        '---\na: ./fotos/selo.png\nb: selo.png\nc: fotos/selo.png\n---\n',
      ),
      folder: 'destination',
    });
    const recorder = recordingAssetResolver(briefAssetResolver({ briefDirectory: briefs }));
    for (const reference of ['./fotos/selo.png', 'selo.png', 'fotos/selo.png']) {
      await recorder.resolver.resolve(reference);
    }

    await output.deliverAssets(recorder.delivered());

    const root = join(workspace, 'entrega');
    expect((await readdir(join(root, 'assets'))).sort()).toEqual(['selo-2.png', 'selo.png']);
    expect(await readFile(join(root, 'editaveis', 'agenda.brief'), 'utf8')).toBe(
      '---\na: selo.png\nb: selo-2.png\nc: selo.png\n---\n',
    );
  });

  it('removes what the previous delivery brought and this one does not, and nothing else', async () => {
    const briefs = await sourceFolder();
    const root = join(workspace, 'entrega');
    const first = await fsDeliveryOutput(root, {
      name: 'agenda',
      brief: new TextEncoder().encode(BRIEF),
      folder: 'destination',
    });
    await first.deliverAssets(await resolvedFrom(briefs));
    await writeFile(join(root, 'assets', 'da-pessoa.png'), 'somebody else put this here');

    // The next export of the same brief no longer uses the seal.
    const second = await fsDeliveryOutput(root, {
      name: 'agenda',
      brief: new TextEncoder().encode(
        "---\ntemplate: agenda-semana\nimagem: 'calendario.png'\n---\n",
      ),
      folder: 'destination',
    });
    const recorder = recordingAssetResolver(briefAssetResolver({ briefDirectory: briefs }));
    await recorder.resolver.resolve('calendario.png');
    const warnings = await second.deliverAssets(recorder.delivered());

    expect((await readdir(join(root, 'assets'))).sort()).toEqual([
      'calendario.png',
      'da-pessoa.png',
    ]);
    expect(warnings.map((item) => [item.code, item.message])).toEqual([
      [
        'W_LEFTOVER_REMOVED',
        "Removed 'assets/selo.png', which the previous export wrote and this one did not produce.",
      ],
    ]);
  });
});
