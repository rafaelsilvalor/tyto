import { type Diagnostic, type Size, err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parseRecipe } from './parse.js';
import type { Plan } from './plan.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type {
  DeliveryLayout,
  DeliveryListing,
  DeliveryPlace,
  ToDeliveryPorts,
} from './to-delivery.js';

/**
 * A workspace in memory: path → bytes as text, with a pixel size for an image. A path is found
 * whatever its case, as on the file systems a workspace mostly lives on.
 */
class FakeWorkspace implements ToDeliveryPorts {
  readonly files = new Map<string, { text: string; size?: Size }>();
  readonly renames: string[] = [];
  where: DeliveryPlace | undefined = { restricted: false };
  exports = 'final';
  /** A rename that fails, by its source path. */
  readonly failing = new Set<string>();

  folder() {
    return this.where;
  }
  layout() {
    const layout: DeliveryLayout = {
      parent: 'entregas',
      folders: ['editaveis'],
      exports: this.exports,
      sizes: { feed: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } },
    };
    return Promise.resolve(ok(layout));
  }
  list(parent: string, exports?: string) {
    const names = new Set<string>();
    for (const path of this.files.keys()) {
      const [first, name] = path.split('/');
      if (first === parent && name !== undefined) names.add(name);
    }
    const listed: DeliveryListing[] = [...names].sort().map((name) => {
      const path = `${parent}/${name}`;
      const record = this.files.get(`${path}/editaveis/delivery.json`)?.text;
      if (record === undefined) return { name, path };
      const folder = exports === '.' ? path : `${path}/${exports ?? '.'}`;
      const images = [...this.files]
        .filter(
          ([file]) => file.startsWith(`${folder}/`) && !file.slice(folder.length + 1).includes('/'),
        )
        .map(([file, { size }]) => ({
          name: file.slice(folder.length + 1),
          ...(size ? { size } : {}),
        }))
        .filter(({ name: image }) => !image.startsWith('.') && /\.(png|jpe?g)$/iu.test(image));
      return { name, path, record, images, editables: 1 };
    });
    return Promise.resolve(ok(listed));
  }
  private find(path: string): string | undefined {
    return [...this.files.keys()].find((file) => file.toLowerCase() === path.toLowerCase());
  }
  read(path: string) {
    const found = this.find(path);
    return Promise.resolve(ok(found === undefined ? undefined : this.files.get(found)?.text));
  }
  stat(path: string) {
    const found = this.find(path);
    return Promise.resolve(
      ok(found === undefined ? undefined : `digest:${this.files.get(found)?.text ?? ''}`),
    );
  }
  make() {
    return Promise.resolve(ok(undefined));
  }
  write(path: string, text: string) {
    this.files.set(path, { text });
    return Promise.resolve(ok(undefined));
  }
  rename(from: string, to: string) {
    const source = this.find(from);
    if (source === undefined || this.failing.has(from)) {
      return Promise.resolve(err([{ message: `cannot rename '${from}'` } as Diagnostic]));
    }
    const target = this.find(to);
    if (target !== undefined && target.toLowerCase() !== source.toLowerCase()) {
      return Promise.resolve(err([{ message: `'${to}' is there` } as Diagnostic]));
    }
    const file = this.files.get(source);
    this.files.delete(source);
    if (file !== undefined) this.files.set(to, file);
    this.renames.push(`${from} → ${to}`);
    return Promise.resolve(ok(undefined));
  }
  now() {
    return '2026-11-19T12:00:00.000Z';
  }

  delivery(name: string, record: object, images: Record<string, Size | undefined>) {
    this.files.set(`entregas/${name}/editaveis/delivery.json`, {
      text: JSON.stringify({ version: 1, ...record }),
    });
    for (const [image, size] of Object.entries(images)) {
      this.files.set(`entregas/${name}/final/${image}`, {
        text: `bytes of ${image}`,
        ...(size === undefined ? {} : { size }),
      });
    }
  }
  exportsOf(name: string): string[] {
    const prefix = `entregas/${name}/final/`;
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .sort();
  }
}

const FEED = { w: 1080, h: 1350 };
const STORY = { w: 1080, h: 1920 };

async function plan(line: string, ports: ToDeliveryPorts | undefined) {
  const recipe = parseRecipe(['recipe ship', 'deliveries', line].join('\n'));
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const verbs = createVerbRegistry({ deliveries: ports });
  const result = await runRecipe(recipe.value, {
    verbs,
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
    resolveData: () => Promise.resolve(err([])),
  });
  if (!result.ok) throw new Error('the run must start');
  const last = result.value.cells.at(-1);
  return {
    verbs,
    plan: last?.plan,
    note: last?.note,
    problems: result.value.cells.flatMap((cell) => cell.diagnostics),
  };
}

async function apply(verbs: ReturnType<typeof createVerbRegistry>, shown: Plan | undefined) {
  if (shown === undefined) throw new Error('a plan');
  const answered = await verbs.get('rename-exports')?.apply?.(shown);
  if (answered === undefined) throw new Error('rename-exports must apply');
  return answered;
}

function lines(shown: Plan | undefined): string[] {
  return (shown?.operations ?? []).map((operation) => operation.description);
}

describe('rename-exports', () => {
  it('plans each export under the stem, in the record order of formats', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'MCA-1',
      {
        key: 'MCA-1',
        stem: 'mca-1_aula',
        formats: [
          { format: 'story', count: 1 },
          { format: 'feed', count: 2 },
        ],
      },
      { 'b-feed.png': FEED, 'a-feed.PNG': FEED, 'cover.jpg': STORY },
    );

    const planned = await plan('rename-exports stem=stem', workspace);

    expect(planned.problems).toEqual([]);
    expect(lines(planned.plan)).toEqual([
      'entregas/MCA-1/final: cover.jpg → mca-1_aula-01.jpg',
      'entregas/MCA-1/final: a-feed.PNG → mca-1_aula-02.png',
      'entregas/MCA-1/final: b-feed.png → mca-1_aula-03.png',
    ]);
    expect(planned.plan?.operations.every((operation) => operation.write === 'rename')).toBe(true);
    expect(workspace.renames).toEqual([]);

    const answered = await apply(planned.verbs, planned.plan);
    expect(answered.ok && answered.value.operations.map(({ status }) => status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    expect(workspace.exportsOf('MCA-1')).toEqual([
      'mca-1_aula-01.jpg',
      'mca-1_aula-02.png',
      'mca-1_aula-03.png',
    ]);

    const again = await plan('rename-exports stem=stem', workspace);
    expect(again.plan?.operations).toEqual([]);
  });

  it('puts the images no format took after the owed ones, so an incomplete delivery ships too', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'MCA-2',
      { key: 'MCA-2', stem: 'mca-2', formats: [{ format: 'feed', count: 1 }] },
      { 'a-square.png': { w: 1080, h: 1080 }, 'b-feed.png': FEED, 'c-broken.png': undefined },
    );

    const planned = await plan('rename-exports stem=stem digits=3', workspace);

    expect(lines(planned.plan)).toEqual([
      'entregas/MCA-2/final: b-feed.png → mca-2-001.png',
      'entregas/MCA-2/final: a-square.png → mca-2-002.png',
      'entregas/MCA-2/final: c-broken.png → mca-2-003.png',
    ]);
  });

  it('plans nothing for an export that already has its name', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'MCA-3',
      { key: 'MCA-3', stem: 'mca-3', formats: [{ format: 'feed', count: 2 }] },
      { 'mca-3-01.png': FEED, 'zz.png': FEED },
    );

    const planned = await plan('rename-exports stem=stem', workspace);

    expect(lines(planned.plan)).toEqual(['entregas/MCA-3/final: zz.png → mca-3-02.png']);
  });

  it('swaps two exports through hidden names when each takes the other one', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'MCA-4',
      {
        key: 'MCA-4',
        stem: 'mca-4',
        formats: [
          { format: 'story', count: 1 },
          { format: 'feed', count: 1 },
        ],
      },
      { 'mca-4-01.png': FEED, 'mca-4-02.png': STORY },
    );

    const planned = await plan('rename-exports stem=stem', workspace);
    expect(lines(planned.plan)).toEqual([
      'entregas/MCA-4/final: mca-4-02.png → mca-4-01.png',
      'entregas/MCA-4/final: mca-4-01.png → mca-4-02.png',
    ]);

    const answered = await apply(planned.verbs, planned.plan);

    expect(answered.ok && answered.value.operations.map(({ status }) => status)).toEqual([
      'applied',
      'applied',
    ]);
    expect(workspace.files.get('entregas/MCA-4/final/mca-4-01.png')?.text).toBe(
      'bytes of mca-4-02.png',
    );
    expect(workspace.files.get('entregas/MCA-4/final/mca-4-02.png')?.text).toBe(
      'bytes of mca-4-01.png',
    );
    expect(workspace.exportsOf('MCA-4')).toEqual(['mca-4-01.png', 'mca-4-02.png']);
  });

  it('fails a delivery whole when one of its files changed since the plan, and runs the others', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'MCA-5',
      { key: 'MCA-5', stem: 'mca-5', formats: [{ format: 'feed', count: 2 }] },
      { 'a.png': FEED, 'b.png': FEED },
    );
    workspace.delivery(
      'MCA-6',
      { key: 'MCA-6', stem: 'mca-6', formats: [{ format: 'feed', count: 1 }] },
      { 'a.png': FEED },
    );
    const planned = await plan('rename-exports stem=stem', workspace);
    workspace.files.set('entregas/MCA-5/final/b.png', { text: 'exported again', size: FEED });

    const answered = await apply(planned.verbs, planned.plan);

    expect(answered.ok && answered.value.operations).toEqual([
      {
        rowKey: 'MCA-5',
        status: 'failed',
        reason: 'entregas/MCA-5/final/b.png changed since the plan',
      },
      {
        rowKey: 'MCA-5',
        status: 'failed',
        reason: 'entregas/MCA-5/final/b.png changed since the plan',
      },
      { rowKey: 'MCA-6', status: 'applied', appliedAt: '2026-11-19T12:00:00.000Z' },
    ]);
    expect(workspace.exportsOf('MCA-5')).toEqual(['a.png', 'b.png']);
    expect(workspace.exportsOf('MCA-6')).toEqual(['mca-6-01.png']);
  });

  it('fails a delivery whose new name another file took since the plan', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'MCA-7',
      { key: 'MCA-7', stem: 'mca-7', formats: [{ format: 'feed', count: 1 }] },
      { 'a.png': FEED },
    );
    const planned = await plan('rename-exports stem=stem', workspace);
    workspace.files.set('entregas/MCA-7/final/MCA-7-01.png', { text: 'somebody else' });

    const answered = await apply(planned.verbs, planned.plan);

    expect(answered.ok && answered.value.operations).toEqual([
      {
        rowKey: 'MCA-7',
        status: 'failed',
        reason: 'entregas/MCA-7/final/mca-7-01.png is taken by another file since the plan',
      },
    ]);
    expect(workspace.renames).toEqual([]);
  });

  it('puts a swap back when a file cannot take its hidden name', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'MCA-8',
      {
        key: 'MCA-8',
        stem: 'mca-8',
        formats: [
          { format: 'story', count: 1 },
          { format: 'feed', count: 1 },
        ],
      },
      { 'mca-8-01.png': FEED, 'mca-8-02.png': STORY },
    );
    const planned = await plan('rename-exports stem=stem', workspace);
    workspace.failing.add('entregas/MCA-8/final/mca-8-01.png');

    const answered = await apply(planned.verbs, planned.plan);

    expect(answered.ok && answered.value.operations.map(({ status }) => status)).toEqual([
      'failed',
      'failed',
    ]);
    expect(workspace.files.get('entregas/MCA-8/final/mca-8-01.png')?.text).toBe(
      'bytes of mca-8-01.png',
    );
    expect(workspace.exportsOf('MCA-8')).toEqual(['mca-8-01.png', 'mca-8-02.png']);
  });

  it('names in its note each delivery it cannot rename, and plans the others', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'A',
      { key: 'A', formats: [{ format: 'feed', count: 1 }] },
      { 'a.png': FEED },
    );
    workspace.delivery('B', { key: 'B', stem: 'b:1' }, { 'a.png': FEED });
    workspace.delivery(
      'C',
      { key: 'C', stem: 'c', formats: [{ format: 'feed', count: 1 }] },
      { 'a.png': FEED, 'b.png': FEED },
    );
    workspace.delivery('D', { key: 'D', stem: 'd' }, { 'x.png': FEED });

    const planned = await plan('rename-exports stem=stem digits=1', workspace);

    expect(lines(planned.plan)).toEqual([
      'entregas/C/final: a.png → c-1.png',
      'entregas/C/final: b.png → c-2.png',
      'entregas/D/final: x.png → d-1.png',
    ]);
    expect(planned.note).toBe(
      "Left 2 deliveries unrenamed: row 'A': 'entregas/A' its stem is empty; row 'B': 'entregas/B' its stem 'b:1' holds a character a folder name may not.",
    );
  });

  it('reads the folder from path= and the stem from any column', async () => {
    const workspace = new FakeWorkspace();
    workspace.exports = '.';
    workspace.delivery('E', { key: 'E', fields: { nome: 'peca-e' } }, {});
    workspace.files.set('entregas/E/a.png', { text: 'a', size: FEED });
    const recipe = [
      'deliveries fields=nome',
      'compose where_it_is="{path|trim}"',
      'rename-exports stem=nome path=where_it_is',
    ].join('\n');

    const planned = await plan(recipe, workspace);

    expect(lines(planned.plan)).toEqual(['entregas/E: a.png → peca-e-01.png']);
  });

  it('refuses digits= outside 1 to 4, a missing stem=, and a host that renames nothing', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery('A', { key: 'A', stem: 'a' }, {});

    const digits = await plan('rename-exports stem=stem digits=5', workspace);
    expect(digits.problems.map(({ code }) => code)).toEqual(['E_RECIPE_ARGUMENTS']);
    const stem = await plan('rename-exports digits=2', workspace);
    expect(stem.problems.map(({ code }) => code)).toEqual(['E_RECIPE_ARGUMENTS']);

    const { rename: _rename, ...without } = workspace;
    const noRename: ToDeliveryPorts = {
      ...without,
      folder: () => workspace.folder(),
      layout: () => workspace.layout(),
      list: (parent, exports) => workspace.list(parent, exports),
      read: (path) => workspace.read(path),
      stat: (path) => workspace.stat(path),
      make: () => workspace.make(),
      write: (path, text) => workspace.write(path, text),
    };
    const host = await plan('rename-exports stem=stem', noRename);
    expect(host.problems.map(({ code }) => code)).toEqual(['E_RECIPE_RENAME_EXPORTS']);
  });

  it('renames nothing in a restricted folder', async () => {
    const workspace = new FakeWorkspace();
    workspace.delivery(
      'A',
      { key: 'A', stem: 'a', formats: [{ format: 'feed', count: 1 }] },
      { 'x.png': FEED },
    );
    const planned = await plan('rename-exports stem=stem', workspace);
    workspace.where = { restricted: true };

    const answered = await apply(planned.verbs, planned.plan);

    expect(answered.ok).toBe(false);
    expect(workspace.renames).toEqual([]);
  });
});
