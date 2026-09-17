import { type Diagnostic as LintDiagnostic, forEachDiagnostic } from '@codemirror/lint';
import { type DiagnosticCode, type TemplateManifest, parseManifest } from '@tyto/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditor, type EditorHandle } from './editor.js';
import { createTemplateAnalyzer } from './template-analysis.js';
import { templateLint } from './template-lint.js';

import promoManifest from '../../templates/templates/promo-curso/manifest.yaml?raw';
import promo from '../../templates/templates/promo-curso/template.html?raw';

/**
 * The real built-in template, checked against its real manifest.
 *
 * The card is accepted against the demo opening these files, so a fixture of my own would
 * be testing a different document than the one the criterion names.
 */
const manifestOf = (yaml: string): TemplateManifest => {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error('the built-in manifest does not parse');
  return parsed.value;
};

const analyzer = createTemplateAnalyzer({ manifest: manifestOf(promoManifest) });

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const open = (doc: string): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, {
    doc,
    language: 'template',
    extensions: [templateLint(analyzer, { delay: 0 })],
  });
  return handle;
};

const markers = (editor: EditorHandle): LintDiagnostic[] => {
  const found: LintDiagnostic[] = [];
  forEachDiagnostic(editor.view.state, (item) => found.push(item));
  return found;
};

const waitForMarker = async (
  editor: EditorHandle,
  code: DiagnosticCode,
  budget: number,
): Promise<LintDiagnostic> => {
  const started = Date.now();
  for (;;) {
    const marker = markers(editor).find((item) => item.source === code);
    if (marker) return marker;
    if (Date.now() - started > budget) throw new Error(`no ${code} marker within ${budget} ms`);
    await new Promise((resume) => setTimeout(resume, 1));
  }
};

/** Waits for the linter to have run at least once, for the cases that expect nothing. */
const settle = async (): Promise<void> => {
  await new Promise((resume) => setTimeout(resume, 120));
};

describe('templateLint', () => {
  /** The card's acceptance criterion, on the file the demo opens. */
  it('marks an unsupported CSS property, and names what to write instead', async () => {
    // Into a class rule and not into `:root`: that block only sets custom properties, so a
    // real property there is `E_TEMPLATE_MARKUP` about the block rather than
    // `E_UNSUPPORTED_CSS` about the name.
    const broken = promo.replace('.photo {', '.photo {\n    background: #fff;');
    expect(broken).not.toBe(promo);

    const editor = open(broken);
    const marker = await waitForMarker(editor, 'E_UNSUPPORTED_CSS', 2000);

    expect(editor.view.state.sliceDoc(marker.from, marker.to)).toBe('background');
    // `background` is not a typo of anything — `vocabulary.ts` maps it by hand, and the
    // message is where that mapping reaches the author.
    expect(marker.message).toContain("'fill'");
  });

  it('says nothing about the built-in template as it ships', async () => {
    const editor = open(promo);
    await settle();

    expect(markers(editor).map((item) => item.source)).toEqual([]);
  });

  it('marks an unsupported tag on the tag name', async () => {
    const broken = promo.replace('<rect id="veil"', '<div id="veil"');
    expect(broken).not.toBe(promo);

    const editor = open(broken);
    const marker = await waitForMarker(editor, 'E_UNSUPPORTED_TAG', 2000);

    expect(editor.view.state.sliceDoc(marker.from, marker.to)).toBe('div');
  });

  it('reports a syntax error, which is raised before anything else is asked', async () => {
    const editor = open('<frame format="feed"\n');

    const marker = await waitForMarker(editor, 'E_TEMPLATE_SYNTAX', 2000);
    expect(marker.severity).toBe('error');
  });

  it('refuses a real property inside :root, which only sets custom ones', async () => {
    const broken = promo.replace('--bg: #0c2340;', '--bg: #0c2340;\n    fill: #fff;');
    expect(broken).not.toBe(promo);

    const editor = open(broken);
    const marker = await waitForMarker(editor, 'E_TEMPLATE_MARKUP', 2000);

    expect(marker.message).toContain('custom properties');
  });
});

describe('the quick fix', () => {
  /**
   * Driven through the linter rather than by calling the suggestion directly: the
   * attribute case reads the syntax tree to find the tag it sits on, and a view is the
   * only thing that has one. Testing the three sources of a suggestion through the same
   * door also keeps them comparable.
   */
  it('fixes a property that is a typo of a real one', async () => {
    const editor = open(promo.replace('.photo {', '.photo {\n    colour: #fff;'));
    const marker = await waitForMarker(editor, 'E_UNSUPPORTED_CSS', 2000);

    expect(marker.actions?.[0]?.name).toBe("Replace with 'color'");
    marker.actions?.[0]?.apply(editor.view, marker.from, marker.to);
    expect(editor.getValue()).toContain('color: #fff;');
  });

  /** The one edit distance cannot reach — `fill` comes from the alias table. */
  it('fixes a property the alias table knows, which no distance would find', async () => {
    const editor = open(promo.replace('.photo {', '.photo {\n    background: #fff;'));
    const marker = await waitForMarker(editor, 'E_UNSUPPORTED_CSS', 2000);

    expect(marker.actions?.[0]?.name).toBe("Replace with 'fill'");
    marker.actions?.[0]?.apply(editor.view, marker.from, marker.to);
    expect(editor.getValue()).toContain('fill: #fff;');
  });

  it('fixes a tag the alias table knows', async () => {
    const editor = open(promo.replace('<rect id="veil"', '<div id="veil"'));
    const marker = await waitForMarker(editor, 'E_UNSUPPORTED_TAG', 2000);

    expect(marker.actions?.[0]?.name).toBe("Replace with 'group'");
  });

  it('fixes an attribute by asking the tree which tag it sits on', async () => {
    const editor = open(promo.replace('<image slot="imagem"', '<image clas="x" slot="imagem"'));
    const marker = await waitForMarker(editor, 'E_UNSUPPORTED_ATTRIBUTE', 2000);

    expect(editor.view.state.sliceDoc(marker.from, marker.to)).toBe('clas');
    expect(marker.actions?.[0]?.name).toBe("Replace with 'class'");
    marker.actions?.[0]?.apply(editor.view, marker.from, marker.to);
    expect(editor.getValue()).toContain('<image class="x"');
  });

  it('fixes an attribute the alias table knows', async () => {
    const editor = open(promo.replace('<image slot="imagem"', '<image style="x" slot="imagem"'));
    const marker = await waitForMarker(editor, 'E_UNSUPPORTED_ATTRIBUTE', 2000);

    expect(marker.actions?.[0]?.name).toBe("Replace with 'class'");
  });

  /**
   * `object-fit` maps to `fit`, which `<image>` takes and `<rect>` does not. The alias is
   * filtered by the tag, so the same word is offered on one and refused on the other.
   */
  it('refuses an alias the tag in question does not accept', async () => {
    const editor = open(promo.replace('<rect id="veil"', '<rect object-fit="cover" id="veil"'));
    const marker = await waitForMarker(editor, 'E_UNSUPPORTED_ATTRIBUTE', 2000);

    expect(marker.actions ?? []).toEqual([]);
  });
});
