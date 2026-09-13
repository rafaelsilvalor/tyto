import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBrief } from '@tyto/brief-lang';
import { type BriefAst, type Diagnostic, loadTemplateRegistry, resolve } from '@tyto/core';
import { fileAssetResolver, nodeFileSystem } from '@tyto/io';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * One brief, from text on a disk through `parse` and into `resolve` (TYTO-70).
 *
 * **This is not a duplicate of the two suites it sits between, and deleting it would put
 * the gap back.** `packages/brief-lang` parses text and asserts the AST, building nothing
 * against a manifest. `packages/core` builds an AST **by hand** and asserts what `resolve`
 * does with it — it has to, because `core` may not import `brief-lang`: the dependency
 * points the other way and lint enforces it (ADR 0010). So no test in either package can
 * write `::rodape` and then watch `resolve` underline it.
 *
 * `tools/contract-test` may import both, which is the whole reason this file is here rather
 * than anywhere else.
 *
 * ## What it is actually measuring
 *
 * `Directive.nameRange` is produced by the parser and consumed by `resolve`, and TYTO-58's
 * acceptance criterion — *"`E_UNKNOWN_SLOT` on `::rodape` with a multi-line body has a range
 * covering `rodape` and nothing else"* — could only be measured as two halves meeting at a
 * type. `resolve.test.ts` states it as `sourceRange(12, 18)`, offsets a person typed, over
 * an AST a person built. Both halves can agree with each other and disagree with the file.
 *
 * Here the range is applied to the bytes it came from: `source.slice(start, end)` has to
 * spell the name. A number nobody chose, checked against text nobody adjusted.
 *
 * ## What only this file can catch, measured
 *
 * Two perturbations were run to find out. Making `resolve` report `directive.range` instead
 * of `nameRange` fails here (`expected 102 to be 6`) **and** in `resolve.test.ts`. Making the
 * parser include the `::` fails here (`expected '::rodape' to be 'rodape'`) **and** in
 * `parse-brief.test.ts`, while all 497 of `core`'s tests pass. So for a straightforward
 * mistake on either side, the suite on that side already speaks.
 *
 * What neither can see is the two sides agreeing with each other and with neither the file:
 * every fixture in both packages is ASCII, so an offset counted in UTF-8 bytes or in code
 * points rather than in UTF-16 code units would pass both. The fixture is deliberately not
 * ASCII for that reason, and the last test below fails if somebody makes it ASCII again.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixture');

let source: string;
let ast: BriefAst;
let problems: readonly Diagnostic[];

beforeAll(async () => {
  source = await readFile(join(FIXTURE, 'unknown-slot.brief'), 'utf8');

  const parsed = parseBrief(source);
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  ast = parsed.value;

  const registry = await loadTemplateRegistry(nodeFileSystem(), join(FIXTURE, 'templates'));
  if (!registry.ok) throw new Error(registry.error.map((item) => item.message).join('; '));

  const resolved = await resolve(ast, {
    registry: registry.value,
    assets: fileAssetResolver({ base: FIXTURE }),
  });

  // Both branches: `resolve` puts errors on `err` and warnings on the `ok` branch
  // (ADR 0013), and which one this brief lands on is not what the file is about.
  problems = resolved.ok ? resolved.warnings : resolved.error;
}, 60_000);

const unknownSlots = (): readonly Diagnostic[] =>
  problems.filter((item) => item.code === 'E_UNKNOWN_SLOT');

describe('a brief with a misspelled directive, parsed and then resolved', () => {
  it('reports E_UNKNOWN_SLOT naming the slot and what the template does declare', () => {
    const [problem] = unknownSlots();

    expect(problem?.message).toContain("Unknown slot 'rodape'");
    // The manifest's own list, so a template that gains a slot and a message that does not
    // are caught here rather than by a reader.
    expect(problem?.message).toContain('cor, imagem, slide');
  });

  it('underlines the name and nothing else, read back out of the source it came from', () => {
    const [problem] = unknownSlots();
    const range = problem?.range;

    expect(range, 'E_UNKNOWN_SLOT carried no range').toBeDefined();
    if (range === undefined) return;

    // The assertion the two suites could not make between them: the offsets select the
    // name in the real file. Not `sourceRange(12, 18)` — offsets nobody typed.
    expect(source.slice(range.start, range.end)).toBe('rodape');

    // And the `::` is outside it, which `Directive.nameRange` promises in so many words.
    expect(source.slice(range.start - 2, range.start)).toBe('::');
  });

  it('is narrower than the directive, which is the reason nameRange exists', () => {
    const [problem] = unknownSlots();
    const range = problem?.range;
    const directive = ast.directives.find((entry) => entry.name === 'rodape');

    expect(range).toBeDefined();
    expect(directive, 'the parser produced no rodape directive').toBeDefined();
    if (range === undefined || directive === undefined) return;

    // Six characters against a directive that runs over four lines. An editor underlining
    // the wide one would say where the directive is, not what is wrong with it — which is
    // what `ast.ts` gives as the reason for the narrow span.
    expect(range.end - range.start).toBe('rodape'.length);
    expect(directive.range.end - directive.range.start).toBeGreaterThan(range.end - range.start);

    // The body is outside the reported range, stated as text rather than as arithmetic.
    expect(source.slice(range.start, directive.range.end)).toContain('Três linhas de corpo');
    expect(source.slice(range.start, range.end)).not.toContain('\n');
  });

  it('measures in UTF-16 code units, which is why the fixture is not ASCII', () => {
    const [problem] = unknownSlots();
    const range = problem?.range;

    expect(range).toBeDefined();
    if (range === undefined) return;

    const before = source.slice(0, range.start);
    const counts = new Set([
      before.length,
      [...before].length,
      new TextEncoder().encode(before).length,
    ]);

    // Three different answers for the same prefix, because the slide above it carries
    // accents and a surrogate pair. A range counted in either of the other two units would
    // land somewhere else, and neither package's own suite would notice: both are ASCII
    // throughout. If this drops below three, the fixture lost the property it exists for.
    expect(counts.size, 'the fixture went ASCII and stopped discriminating').toBe(3);
    expect(source.slice(range.start, range.end)).toBe('rodape');
  });

  it('still resolves the directive the template does declare', () => {
    // A brief that failed for some other reason would satisfy the assertions above while
    // proving nothing about the seam. `::slide` is valid and the parser saw it.
    expect(ast.directives.map((entry) => entry.name)).toEqual(['slide', 'rodape']);
    expect(unknownSlots()).toHaveLength(1);
  });
});
