import { describe, expect, it } from 'vitest';

import { FLOWS, tasks } from './__fixtures__/flows.js';
import { columnOf, runOverShop } from './__fixtures__/rules-harness.js';
import { type FoldedGraph, foldGraph, shortestPath } from './path.js';
import { type CellValue, comparable } from './table.js';

const FILES = { './flows.json': FLOWS };
type Flow = 'first' | 'second';

function pathLine(flow: Flow): string {
  return (
    `path from=current to=target graph=@./flows.json#/${flow}/graph ` +
    'avoid=@./flows.json#/avoid into=steps'
  );
}

/** The walk the verb writes for each pair, in order, through one flow's graph. */
async function walks(
  flow: Flow,
  pairs: readonly (readonly [CellValue, CellValue])[],
): Promise<readonly CellValue[]> {
  const { table, problem } = await runOverShop(
    [pathLine(flow)],
    FILES,
    tasks(['current', 'target'], pairs),
  );
  expect(problem).toBeUndefined();
  return Object.values(columnOf(table, 'steps'));
}

async function walk(flow: Flow, from: CellValue, to: CellValue): Promise<CellValue> {
  const [steps] = await walks(flow, [[from, to]]);
  if (steps === undefined) throw new Error('the table has no row');
  return steps;
}

const AVOIDED = new Set(FLOWS.avoid.map((name) => comparable(name)));

describe('path', () => {
  // Buraqueira: test_mc_feito_passa_pela_aprovacao_inteira
  it('walks the first flow from to do to done through the whole approval', async () => {
    expect(await walk('first', 'TO DO', 'DONE')).toEqual([
      'DOING',
      'APPROVAL',
      'APPROVED',
      'DOING 2',
      'DONE',
    ]);
  });

  // Buraqueira: test_mca_feito_a_partir_da_aprovacao_volta_pela_fila
  it('goes back through to do when approval has no arrow to the end', async () => {
    expect(await walk('second', 'APPROVÁL', 'Finished')).toEqual([
      'TO DO',
      'IN PROGRESS',
      'Finished',
    ]);
  });

  // Buraqueira: test_revisao_no_mc_e_fazendo_2
  it('maps review to doing 2 and walks there, map and path together', async () => {
    const { table, problem } = await runOverShop(
      ['map status using=@./flows.json#/first/map into=target', pathLine('first')],
      FILES,
      tasks(['current', 'status'], [['DOING', 'review']]),
    );
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'target')).toEqual({ 'T-0': 'DOING 2' });
    expect(columnOf(table, 'steps')).toEqual({ 'T-0': ['APPROVAL', 'APPROVED', 'DOING 2'] });
  });

  // Buraqueira: test_caminho_ignora_acento_e_caixa
  it('compares names without accents or case, and writes them as the graph spells them', async () => {
    expect(await walk('second', 'approval', 'finished')).toEqual([
      'TO DO',
      'IN PROGRESS',
      'Finished',
    ]);
  });

  // Buraqueira: test_ja_esta_la_e_caminho_vazio
  it('answers an empty walk when the row is already there', async () => {
    expect(await walk('second', 'Finished', ' finished ')).toEqual([]);
    // Checked before avoid=: a row already parked in an avoided status has nowhere to go.
    expect(await walk('second', 'WAITING', 'waiting')).toEqual([]);
  });

  // Buraqueira: test_nunca_passa_nem_termina_em_proibido
  it('never passes through, nor ends in, an avoided status', async () => {
    for (const flow of ['first', 'second'] as const) {
      const pairs = Object.keys(FLOWS[flow].graph).flatMap((from) =>
        Object.values(FLOWS[flow].map).map((to) => [from, to] as const),
      );
      const found = await walks(flow, pairs);
      // Most pairs are joined, so the check below reads real walks and not a column of nulls.
      expect(found.filter((steps) => Array.isArray(steps) && steps.length > 0).length).toBe(
        flow === 'first' ? 13 : 20,
      );
      for (const steps of found) {
        const names = Array.isArray(steps) ? steps : [];
        expect(names.filter((name) => AVOIDED.has(comparable(name)))).toEqual([]);
      }
    }
    expect(await walk('second', 'TO DO', 'CANCELLED')).toBeNull();
  });

  it('starts from an avoided status, since the walk is already there', async () => {
    const { table } = await runOverShop(
      ['path from=current to=target avoid=PARKED into=steps graph={"PARKED": ["TO DO"]}'],
      FILES,
      tasks(['current', 'target'], [['parked', 'to do']]),
    );
    expect(columnOf(table, 'steps')).toEqual({ 'T-0': ['TO DO'] });
  });

  // Buraqueira: test_grafo_que_nao_liga_devolve_none
  it('answers nothing when the graph does not join the two', async () => {
    expect(await walk('first', 'DONE', 'TO DO')).toBeNull();
    expect(await walk('first', 'NOWHERE', 'DONE')).toBeNull();
  });

  it('answers nothing for an empty cell on either side', async () => {
    expect(
      await walks('first', [
        [null, 'DONE'],
        ['TO DO', ''],
        [null, null],
      ]),
    ).toEqual([null, null, null]);
  });

  it('takes the first walk found among walks of one length, in arrow order', async () => {
    const graph = { A: ['B', 'C'], B: ['D'], C: ['D'] };
    const { table } = await runOverShop(
      ['path from=current to=target avoid=Z into=steps graph=@./diamond.json'],
      { './diamond.json': graph },
      tasks(['current', 'target'], [['A', 'D']]),
    );
    expect(columnOf(table, 'steps')).toEqual({ 'T-0': ['B', 'D'] });
    const reversed = await runOverShop(
      ['path from=current to=target avoid=Z into=steps graph=@./reversed.json'],
      { './reversed.json': { A: ['C', 'B'], B: ['D'], C: ['D'] } },
      tasks(['current', 'target'], [['A', 'D']]),
    );
    expect(columnOf(reversed.table, 'steps')).toEqual({ 'T-0': ['C', 'D'] });
  });

  it('writes a list column, and recomputes one the table has in its place', async () => {
    const { table } = await runOverShop(
      [pathLine('first'), pathLine('first')],
      FILES,
      tasks(['current', 'target'], [['TO DO', 'DOING']]),
    );
    expect(table?.columns.map(({ name, type, origin }) => [name, type, origin])).toEqual([
      ['key', 'text', 'test'],
      ['current', 'text', 'test'],
      ['target', 'text', 'test'],
      ['steps', 'list', 'path'],
    ]);
  });

  describe('shortestPath', () => {
    /**
     * Layers of two nodes, each joined to both of the next layer's: the number of walks doubles
     * with every layer, so a search that marked a node only when it left the queue would read
     * a node's arrows once per walk reaching it.
     */
    function layered(layers: number, reads: Map<string, number>): FoldedGraph {
      const graph = new Map<string, readonly string[]>();
      const counted = (node: string, next: string[]) =>
        new Proxy(next, {
          get(target, property, receiver) {
            if (property === Symbol.iterator) reads.set(node, (reads.get(node) ?? 0) + 1);
            return Reflect.get(target, property, receiver) as unknown;
          },
        });
      graph.set('start', counted('start', ['a0', 'b0']));
      for (let layer = 0; layer < layers; layer++) {
        const next = layer + 1 < layers ? [`a${String(layer + 1)}`, `b${String(layer + 1)}`] : [];
        graph.set(`a${String(layer)}`, counted(`a${String(layer)}`, [...next]));
        graph.set(`b${String(layer)}`, counted(`b${String(layer)}`, [...next]));
      }
      return graph;
    }

    it("reads each node's arrows once, marking a node when it is queued", () => {
      const reads = new Map<string, number>();
      expect(shortestPath(layered(8, reads), 'start', 'unreachable', new Set())).toBeNull();
      const layers = [...Array(8).keys()].flatMap((layer) => [
        `a${String(layer)}`,
        `b${String(layer)}`,
      ]);
      const once = Object.fromEntries(['start', ...layers].map((node) => [node, 1]));
      expect(Object.fromEntries(reads)).toEqual(once);
    });

    it('never enters an avoided node, even when it is the only way through', () => {
      const graph = foldGraph({ A: ['B'], B: ['C'] });
      if (!graph.ok) throw new Error(graph.error);
      expect(shortestPath(graph.value, 'A', 'C', new Set())).toEqual(['B', 'C']);
      expect(shortestPath(graph.value, 'A', 'C', new Set(['b']))).toBeNull();
      expect(shortestPath(graph.value, 'A', 'C', new Set(['c']))).toBeNull();
    });
  });

  describe('refuses', () => {
    async function refusal(line: string, files: Record<string, unknown> = FILES) {
      const { problem, at } = await runOverShop(
        [line],
        files,
        tasks(['current', 'target'], [['TO DO', 'DONE']]),
      );
      return [problem?.code, at];
    }

    it('a graph whose names fold to one', async () => {
      const [code, at] = await refusal(
        'path from=current to=target avoid=Z into=steps graph=@./twice.json',
        { './twice.json': { Approval: ['A'], 'APPROVÁL ': ['B'] } },
      );
      expect([code, at]).toEqual(['E_RECIPE_DATA_SHAPE', 'graph=@./twice.json']);
    });

    it('a graph that is not names to lists of names', async () => {
      const [code] = await refusal(
        'path from=current to=target graph=@./flows.json#/first/map avoid=Z into=steps',
      );
      expect(code).toBe('E_RECIPE_DATA_SHAPE');
    });

    it('a missing argument, naming it', async () => {
      const { problem } = await runOverShop(
        ['path from=current to=target graph=@./flows.json#/first/graph into=steps'],
        FILES,
        tasks(['current', 'target'], [['TO DO', 'DONE']]),
      );
      expect(problem?.code).toBe('E_RECIPE_ARGUMENTS');
      expect(problem?.message).toContain('needs avoid=');
    });

    it('an argument given twice, one it does not take, and a bare word', async () => {
      const line = pathLine('first');
      expect(await refusal(`${line} into=more`)).toEqual(['E_RECIPE_ARGUMENTS', 'into=more']);
      expect(await refusal(`${line} by=x`)).toEqual(['E_RECIPE_ARGUMENTS', 'by=x']);
      expect(await refusal(`${line} fast`)).toEqual(['E_RECIPE_ARGUMENTS', 'fast']);
    });

    it('a column the table lacks', async () => {
      const [code] = await refusal(
        'path from=status to=target graph=@./flows.json#/first/graph avoid=Z into=steps',
      );
      expect(code).toBe('E_RECIPE_UNKNOWN_COLUMN');
    });
  });
});
