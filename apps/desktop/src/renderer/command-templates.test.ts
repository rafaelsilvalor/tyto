import { describe, expect, it } from 'vitest';

import {
  type PanelTemplatesAnswer,
  type PanelTemplatesPorts,
  createPanelTemplates,
} from './command-templates.js';

/** TYTO-729: one `commands:templates` per working folder and trust, never one per keystroke. */

function ports(overrides: Partial<PanelTemplatesPorts> = {}) {
  const asked: (string | undefined)[] = [];
  let trust: 'trusted' | 'restricted' | 'none' = 'restricted';
  const answer: PanelTemplatesAnswer = {
    templates: [
      { name: 'cartaz', formats: ['feed', 'story'] },
      { name: 'curto', formats: ['feed'], aliasOf: 'cartaz' },
    ],
  };
  return {
    asked,
    setTrust: (next: typeof trust) => {
      trust = next;
    },
    ports: {
      ask: (folder: string | undefined) => {
        asked.push(folder);
        return Promise.resolve(answer);
      },
      folderOf: (steps: readonly string[]) =>
        Promise.resolve(steps[0] === 'gone' ? undefined : `id:${steps.join('/')}`),
      trust: () => trust,
      caseless: true,
      ...overrides,
    } satisfies PanelTemplatesPorts,
  };
}

describe('the command panel templates', () => {
  it("answers the working folder's listing, asked once however often it is read", async () => {
    const fake = ports();
    const templates = createPanelTemplates(fake.ports);

    const first = await templates.of(['entregas']);
    await templates.of(['entregas']);
    await templates.of(['ENTREGAS']);
    await templates.of([]);
    await templates.of([]);

    expect(first).toEqual([
      { name: 'cartaz', formats: ['feed', 'story'] },
      { name: 'curto', formats: ['feed'], aliasOf: 'cartaz' },
    ]);
    // The open folder is asked without an id; a folder by the id main minted for it.
    expect(fake.asked).toEqual(['id:entregas', undefined]);
  });

  it('asks again after cd, a change of trust, or forget', async () => {
    const fake = ports();
    const templates = createPanelTemplates(fake.ports);

    await templates.of(['entregas']);
    await templates.of(['entregas', 'novembro']);
    fake.setTrust('trusted');
    await templates.of(['entregas']);
    templates.forget();
    await templates.of(['entregas']);

    expect(fake.asked).toEqual([
      'id:entregas',
      'id:entregas/novembro',
      'id:entregas',
      'id:entregas',
    ]);
  });

  it("says an answer's note once per kept answer, not once per completion", async () => {
    const said: string[] = [];
    const fake = ports({
      ask: () => Promise.resolve({ templates: [], note: 'aviso: it has not been fetched yet' }),
      note: (text) => said.push(text),
    });
    const templates = createPanelTemplates(fake.ports);

    await templates.of(['entregas']);
    await templates.of(['entregas']);
    await templates.of(['entregas']);
    expect(said).toEqual(['aviso: it has not been fetched yet']);
    templates.forget();
    await templates.of(['entregas']);
    expect(said).toHaveLength(2);
  });

  it('offers nothing for a folder that is gone, and keeps no failed ask', async () => {
    let fail = true;
    const fake = ports();
    const templates = createPanelTemplates({
      ...fake.ports,
      ask: (folder) => {
        fake.asked.push(folder);
        return fail ? Promise.reject(new Error('no bridge')) : Promise.resolve({ templates: [] });
      },
    });

    expect(await templates.of(['gone'])).toEqual([]);
    expect(await templates.of(['entregas'])).toEqual([]);
    fail = false;
    expect(await templates.of(['entregas'])).toEqual([]);

    expect(fake.asked).toEqual(['id:entregas', 'id:entregas']);
  });
});
