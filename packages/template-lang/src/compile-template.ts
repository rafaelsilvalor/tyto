import {
  type Diagnostic,
  type Diagnostics,
  type Result,
  type Template,
  type TemplateManifest,
  err,
  fromDiagnostics,
  sortDiagnostics,
} from '@tyto/core';
import { defineTemplate } from '@tyto/core/template';

import type { TemplateElement } from './ast.js';
import { type Program, type TemplateAssets, buildFrame, checkStatically } from './build.js';
import { attributeOf, collectFrames, interpolatedSlots } from './frames.js';
import { parseTemplate } from './parse-template.js';
import { compileStylesheet } from './style.js';

/**
 * `template.html` × manifest → the same thing a `template.ts` exports.
 *
 * This is the whole point of the package. `compile` (E4.2) takes a `Template` — a manifest
 * and a function it calls once per (artwork, format) — and has no idea which of the two
 * authoring paths produced it. Everything the markup path knows that the code path does
 * not is settled here, before the function is handed over, so that the stage downstream
 * stays exactly as it was (ADR 0005).
 *
 * One thing does leave that a `template.ts` cannot produce: `renderedSlots`. `resolve`
 * emits `W_UNUSED_SLOT` only when a caller tells it which slots the template draws, and a
 * plain function call cannot report that. Markup can — every `slot="x"` in the file is the
 * set — which closes the acceptance criterion E3.3 had to leave open.
 */

export interface CompileTemplateOptions {
  readonly manifest: TemplateManifest;
  /** The files beside `template.html`; a template with no `src` needs none. */
  readonly assets?: TemplateAssets;
}

export interface HtmlTemplate extends Template {
  /**
   * Every slot the markup draws, in source order and deduplicated.
   *
   * Hand it to `resolve` as `renderedSlots` and a brief that fills a slot this template
   * ignores gets `W_UNUSED_SLOT`; leave it out and the warning stays silent rather than
   * being guessed at.
   */
  readonly renderedSlots: readonly string[];
}

function slotsDrawnBy(elements: readonly TemplateElement[], found: Set<string>): void {
  for (const element of elements) {
    const named = attributeOf(element, 'slot');
    if (named !== undefined && named.value !== '') found.add(named.value);
    const source = attributeOf(element, 'src');
    if (source !== undefined) for (const name of interpolatedSlots(source.value)) found.add(name);
    slotsDrawnBy(element.children, found);
  }
}

/** At most one slot repeats (the manifest schema enforces it); this is the one. */
function repeatableOf(manifest: TemplateManifest): string | undefined {
  return Object.entries(manifest.slots).find(([, slot]) => slot.repeat)?.[0];
}

export function compileTemplate(
  source: string,
  options: CompileTemplateOptions,
): Result<HtmlTemplate, Diagnostics> {
  // Syntax first and alone: a file that does not parse has no tree to ask anything else
  // about, and a hundred follow-on complaints would bury the one line that has to change.
  const parsed = parseTemplate(source);
  if (!parsed.ok) return parsed;

  const problems: Diagnostic[] = [];
  const report = (item: Diagnostic): void => {
    problems.push(item);
  };

  const { manifest } = options;
  const repeatable = repeatableOf(manifest);
  const frames = collectFrames(parsed.value, manifest, report);
  const entries = compileStylesheet(parsed.value.styles, {
    formats: manifest.formats,
    slots: Object.keys(manifest.slots),
    repeatable,
    report,
  });

  const program: Program = {
    manifest,
    frames,
    entries,
    assets: options.assets ?? {},
    repeatable,
  };

  // Only worth running on markup that already type-checks against the manifest: a static
  // walk over a tree with an unknown tag in it reports the consequences of a problem the
  // author has already been told about.
  if (problems.length === 0) checkStatically(program, report);

  if (problems.length > 0) return err(sortDiagnostics(problems));

  const drawn = new Set<string>();
  for (const definition of frames.values()) slotsDrawnBy(definition.children, drawn);

  const template: HtmlTemplate = {
    ...defineTemplate(manifest, (context) => buildFrame(program, context)),
    renderedSlots: [...drawn],
  };

  return fromDiagnostics(template, []);
}

export type { TemplateAssets };
