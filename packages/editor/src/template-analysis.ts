import { type Diagnostics, type TemplateManifest } from '@tyto/core';
import { type TemplateAssets, compileTemplate } from '@tyto/template-lang';

/**
 * What the editor knows about the template in front of it.
 *
 * The same port shape as `BriefAnalyzer`, and for the same reason: the diagnostics an
 * author wants underlined come from `compileTemplate`, which needs the manifest of the
 * folder the file lives in — and a renderer may not open a folder (ADR 0010). The host
 * fills the port.
 *
 * Simpler than the brief's in one way: there is no manifest to hand on to completion,
 * because a template's vocabulary is fixed. Tags, attributes and CSS properties are
 * enumerated once in `@tyto/template-lang`'s `vocabulary.ts` and are the same in every
 * template ever written.
 */

export interface TemplateAnalysis {
  /** The document this was computed against, so a late answer can be recognised as late. */
  readonly source: string;
  readonly diagnostics: Diagnostics;
}

export interface TemplateAnalyzer {
  analyze(source: string): Promise<TemplateAnalysis>;
}

export interface TemplateAnalyzerOptions {
  /**
   * The manifest of the template being edited.
   *
   * `compileTemplate` checks `slot="…"` against it, so without one every slot in the file
   * would be wrong. A host that does not know which template a buffer belongs to should
   * not lint it at all rather than lint it against a guess.
   */
  readonly manifest: TemplateManifest;
  /** The files beside `template.html`; a template with no `src` needs none. */
  readonly assets?: TemplateAssets;
}

/**
 * Runs `compileTemplate` and keeps only what it said.
 *
 * The compiled template is thrown away — the editor never builds a scene. Running the
 * compiler anyway is the point: `E_UNSUPPORTED_CSS`, `E_UNSUPPORTED_TAG` and
 * `E_UNSUPPORTED_ATTRIBUTE` are raised while the markup and the stylesheet are read, and a
 * second reader that only looked for them would be a second, worse compiler.
 *
 * This is where a template differs from a brief: compiling a *template* executes nothing,
 * because `compileTemplate` reads markup rather than running code. Running a brief's
 * `compile` would execute the template, which is why the brief analyzer stops at `resolve`.
 */
export function createTemplateAnalyzer(options: TemplateAnalyzerOptions): TemplateAnalyzer {
  return {
    analyze: (source: string): Promise<TemplateAnalysis> => {
      const compiled = compileTemplate(source, {
        manifest: options.manifest,
        ...(options.assets === undefined ? {} : { assets: options.assets }),
      });
      return Promise.resolve({
        source,
        diagnostics: compiled.ok ? compiled.warnings : compiled.error,
      });
    },
  };
}
