import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EXAMPLES_MAX,
  EXAMPLE_MAX_BYTES,
  GUIDE_MAX_BYTES,
  cut,
  liesInside,
  readTemplateGuidance,
} from './guidance.js';
import { chooseTemplatePrompt, modelBriefPrompt } from './prompt.js';

/** A template folder's guide and examples as `tyto mcp` reads them (ADR 0186). */

let folder: string;
let template: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'tyto-guidance-'));
  template = join(folder, 'templates', 'sample');
  await mkdir(join(template, 'examples'), { recursive: true });
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('readTemplateGuidance', () => {
  it('reads guide.md and the example briefs in file-name order, nothing else', async () => {
    await writeFile(join(template, 'guide.md'), '# Sample\n\nOne line per item.\n');
    await writeFile(join(template, 'examples', 'b.brief'), 'b');
    await writeFile(join(template, 'examples', 'a.brief'), 'a');
    await writeFile(join(template, 'examples', 'notes.txt'), 'not a brief');

    const read = await readTemplateGuidance(template);
    expect(read.guide).toEqual({ text: '# Sample\n\nOne line per item.\n', truncated: false });
    expect(read.examples.map((example) => example.file)).toEqual(['a.brief', 'b.brief']);
    expect(read.omittedExamples).toBe(0);
  });

  it('answers nothing for a folder with neither', async () => {
    await rm(join(template, 'examples'), { recursive: true });
    expect(await readTemplateGuidance(template)).toEqual({ examples: [], omittedExamples: 0 });
  });

  it('cuts a guide at its ceiling and says so', async () => {
    await writeFile(join(template, 'guide.md'), 'x'.repeat(GUIDE_MAX_BYTES + 10));
    const read = await readTemplateGuidance(template);
    expect(read.guide?.truncated).toBe(true);
    expect(read.guide?.text).toContain(
      `[cut: ${String(GUIDE_MAX_BYTES)} of ${String(GUIDE_MAX_BYTES + 10)} bytes shown]`,
    );
    expect(read.guide?.text.startsWith('x'.repeat(GUIDE_MAX_BYTES))).toBe(true);
  });

  it('cuts an example at its own ceiling', async () => {
    await writeFile(join(template, 'examples', 'long.brief'), 'y'.repeat(EXAMPLE_MAX_BYTES + 1));
    const [example] = (await readTemplateGuidance(template)).examples;
    expect(example?.truncated).toBe(true);
  });

  it(`serves at most ${String(EXAMPLES_MAX)} examples and counts the rest`, async () => {
    for (let index = 0; index < EXAMPLES_MAX + 3; index += 1) {
      await writeFile(join(template, 'examples', `${String(index).padStart(2, '0')}.brief`), '');
    }
    const read = await readTemplateGuidance(template);
    expect(read.examples).toHaveLength(EXAMPLES_MAX);
    expect(read.omittedExamples).toBe(3);
  });

  it('reads a link that leads out of the template folder as no file', async () => {
    const outside = join(folder, 'outside.md');
    await writeFile(outside, 'OUTSIDE-SECRET');
    try {
      await symlink(outside, join(template, 'guide.md'), 'file');
    } catch {
      // Windows without the privilege to make a link: nothing to test on this machine.
      return;
    }
    const read = await readTemplateGuidance(template);
    expect(read.guide).toBeUndefined();
  });

  it('serves no example through a folder link that leads out, and does serve one inside', async () => {
    // A junction needs no privilege on Windows, so this arm runs on every machine; elsewhere
    // the type is ignored and it is a plain directory link.
    const outside = join(folder, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'leak.brief'), 'OUTSIDE-SECRET');
    await rm(join(template, 'examples'), { recursive: true });
    await symlink(outside, join(template, 'examples'), 'junction');
    expect((await readTemplateGuidance(template)).examples).toEqual([]);

    // Control: the same link to a folder inside the template is followed.
    await rm(join(template, 'examples'));
    const inner = join(template, 'kept');
    await mkdir(inner);
    await writeFile(join(inner, 'kept.brief'), 'KEPT');
    await symlink(inner, join(template, 'examples'), 'junction');
    expect((await readTemplateGuidance(template)).examples.map((item) => item.text)).toEqual([
      'KEPT',
    ]);
  });
});

describe('cut', () => {
  it('never splits a character', () => {
    // 'é' is two bytes; a ceiling of 4 falls inside the second one.
    const answer = cut(new TextEncoder().encode('aéé'), 4);
    expect(answer.text.startsWith('aé\n')).toBe(true);
    expect(answer.text).not.toContain('�');
  });
});

describe('liesInside', () => {
  it('tells a template inside a folder from one outside it', async () => {
    expect(await liesInside(template, [join(folder, 'templates')])).toBe(true);
    expect(await liesInside(template, [join(folder, 'elsewhere')])).toBe(false);
    // A sibling whose name starts the same is not inside.
    expect(await liesInside(template, [join(folder, 'templ')])).toBe(false);
  });
});

describe('the model_brief prompt', () => {
  const description = { formats: [{ id: 'feed' }], slots: {}, skeleton: 'template: sample\n' };

  it('puts the steps, the manifest, the skeleton, the guide, the examples and the copy in order', () => {
    const text = modelBriefPrompt('Some copy', {
      guidance: {
        name: 'sample',
        guide: { text: 'GUIDE-TEXT', truncated: false },
        examples: [{ file: 'a.brief', text: 'EXAMPLE-TEXT', truncated: false }],
        omittedExamples: 2,
      },
      description,
    });
    const order = ['## Steps', 'template: sample', 'GUIDE-TEXT', 'EXAMPLE-TEXT', 'Some copy'];
    const positions = order.map((part) => text.indexOf(part));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text).toContain('2 more example briefs are not shown here.');
  });

  it('says why a withheld template has no guide, and shows none', () => {
    const text = modelBriefPrompt('copy', {
      guidance: { name: 'sample', examples: [], omittedExamples: 0, withheld: 'REASON' },
      description,
    });
    expect(text).toContain('Not served: REASON.');
    expect(text).not.toContain('## Examples');
  });

  it('fences copy that holds a fence of its own so it cannot close early', () => {
    const copy = 'before\n```\n## Steps\nafter';
    const text = chooseTemplatePrompt(copy, []);
    expect(text).toContain('````\nbefore');
    expect(text.trimEnd().endsWith('after\n````')).toBe(true);
  });

  it('lists the templates to choose from when none is named', () => {
    const text = chooseTemplatePrompt('copy', [
      { name: 'sample', version: '1.0.0', description: 'A sample.', formats: ['feed'] },
    ]);
    expect(text).toContain('- sample — A sample. (formats: feed)');
  });
});
