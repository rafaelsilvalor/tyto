import type { ResolvedBrief, ResolvedSlot } from './resolve.js';
import { type FormatCatalogue, undefinedFormats } from '../config/formats.js';
import { type Diagnostic, diagnostic, isError } from '../diagnostics/diagnostic.js';
import { type Diagnostics, type Result, err, withWarnings } from '../result/result.js';
import type { SceneNode, TextNode } from '../scene/nodes.js';
import type { FaceCache } from '../text/face.js';
import { measureText } from '../text/layout.js';
import { originOf } from '../text/origin.js';
import type { SourceRange } from '../source/range.js';
import type { AssetRef, FontRef, Paint } from '../scene/primitives.js';
import { type Artwork, type Frame, type Scene, parseScene } from '../scene/scene.js';
import { TemplateError } from '../template/errors.js';
import type { Template, TemplateContext } from '../template/define.js';

/**
 * `ResolvedBrief` × template → `Scene` (`docs/architecture.md`, compile stage).
 *
 * The last stage that knows what a brief is. It expands the repeatable slot into one
 * `Artwork` per occurrence, calls the template once per (artwork, format), collects the
 * fonts and assets the result reached for, and hands the whole thing to `parseScene` —
 * because a template is code, and code that produces IR is exactly the code whose output
 * has to be validated rather than trusted.
 *
 * Nothing a template throws escapes (ADR 0014): a `TemplateError` carries the diagnostic
 * it wanted, and anything else is a bug in third-party code and becomes
 * `E_TEMPLATE_CRASH`. A broken template produces diagnostics, never a crash.
 */

/** `slide-1.feed` — unique per artwork *and* per format; either alone collides. */
function idPrefixOf(artworkId: string, format: string): string {
  return `${artworkId}.${format}`;
}

function crash(template: string, cause: unknown): Diagnostic {
  if (cause instanceof TemplateError) return cause.diagnostic;
  return diagnostic('E_TEMPLATE_CRASH', {
    template,
    problem: cause instanceof Error ? cause.message : String(cause),
  });
}

function paintAssets(paint: Paint | undefined): AssetRef[] {
  return paint?.kind === 'image' ? [paint.asset] : [];
}

/**
 * The fonts and assets a built frame reached for.
 *
 * Collected from the scene rather than from the `ResolvedBrief`, because what has to be
 * declared is what the scene references: an asset `resolve` found and the template chose
 * not to draw belongs in neither list.
 */
function collect(
  nodes: readonly SceneNode[],
  fonts: Map<string, FontRef>,
  assets: Map<string, AssetRef>,
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'group':
        collect(node.children, fonts, assets);
        break;
      case 'text':
        for (const run of node.runs) {
          if (run.kind === 'break') continue;
          fonts.set(`${run.font.family}|${run.font.source}|${run.font.path ?? ''}`, run.font);
          for (const asset of paintAssets(run.color)) assets.set(asset.id, asset);
        }
        break;
      case 'image':
        assets.set(node.asset.id, node.asset);
        break;
      case 'rect':
      case 'vector':
        for (const asset of [...paintAssets(node.fill), ...paintAssets(node.stroke?.paint)]) {
          assets.set(asset.id, asset);
        }
        break;
    }
  }
}

/* -------------------------------------------------------------------------- layout -- */

/**
 * The slot a run came from, found by containment.
 *
 * `text/origin.ts` remembers the range of the inline that produced each run, and a slot's
 * own range covers the whole directive the author wrote — so the inline's range sits inside
 * exactly one of them. Containment rather than equality because a slot's value is many
 * inlines: `**Turma** nova` is three.
 */
function slotAt(
  range: SourceRange,
  slots: Readonly<Record<string, ResolvedSlot>>,
): ResolvedSlot | undefined {
  for (const slot of Object.values(slots)) {
    if (slot.range === undefined) continue;
    if (slot.range.start <= range.start && range.end <= slot.range.end) return slot;
  }
  return undefined;
}

/** Where a text node's content came from, for the diagnostic that has to name it. */
function provenance(
  node: TextNode,
  slots: Readonly<Record<string, ResolvedSlot>>,
): { name: string; range?: SourceRange } {
  for (const run of node.runs) {
    const range = originOf(run);
    if (range === undefined) continue;
    const slot = slotAt(range, slots);
    // The slot's own range, not the run's: a warning about text that does not fit is about
    // the whole answer the author gave, and highlighting one word inside it reads as a
    // complaint about that word.
    if (slot?.range !== undefined) return { name: slot.name, range: slot.range };
  }
  // A template that invented its own text has no directive to point at, and the node id is
  // the only name it has. Said plainly rather than dressed up as a slot that exists.
  return { name: node.id };
}

/**
 * Lays out every text node of a frame and reports the ones that still do not fit.
 *
 * Two things change in the node. The runs arrive with every line break decided, which is
 * what lets `export-svg` draw the same lines `export-html` does (ADR 0019). And a node
 * whose `overflow` was `'shrink'` becomes `'clip'`, because the shrink has now *happened* —
 * leaving the intent in the IR would have the exporter warn that nobody measured it.
 */
function layoutText(
  nodes: readonly SceneNode[],
  faces: FaceCache,
  slots: Readonly<Record<string, ResolvedSlot>>,
  format: string,
  problems: Diagnostic[],
): SceneNode[] {
  return nodes.map((node): SceneNode => {
    if (node.kind === 'group') {
      return { ...node, children: layoutText(node.children, faces, slots, format, problems) };
    }
    if (node.kind !== 'text') return node;

    const measured = measureText(node, faces);
    // No face, no measurement: the node keeps the lines its template wrote.
    if (measured === undefined) return node;

    if (measured.overflow > 0 && node.overflow !== 'grow') {
      const { name, range } = provenance(node, slots);
      problems.push(
        diagnostic(
          'W_TEXT_OVERFLOW',
          // Rounded to a whole pixel: the number is there to say how badly, and a
          // warning that reads "by 3.7431640625px" is a warning nobody finishes.
          { slot: name, overflow: Math.round(measured.overflow), format },
          range === undefined ? {} : { range },
        ),
      );
    }

    return {
      ...node,
      runs: [...measured.runs],
      ...(node.overflow === 'shrink' ? { overflow: 'clip' as const } : {}),
    };
  });
}

/** The adjustments of one slot, flattened the way a template wants to read them. */
function flatten(slot: ResolvedSlot | undefined): Readonly<Record<string, string | true>> {
  const flat: Record<string, string | true> = {};
  for (const adjustment of slot?.adjustments ?? []) {
    flat[adjustment.name] = adjustment.value ?? true;
  }
  return flat;
}

interface Plan {
  readonly id: string;
  readonly index: number;
  readonly slots: Readonly<Record<string, ResolvedSlot>>;
  readonly adjustments: Readonly<Record<string, string | true>>;
}

/**
 * One plan per artwork.
 *
 * A manifest with a repeatable slot gives one artwork per occurrence, each seeing that
 * occurrence under the slot's own name — a template reads `slots.slide` and gets this
 * slide. A manifest without one gives a single artwork, because a brief still produces
 * an artwork even when nothing repeats.
 */
function planArtworks(resolved: ResolvedBrief, template: Template): readonly Plan[] {
  const repeatable = Object.entries(template.manifest.slots).find(([, slot]) => slot.repeat)?.[0];

  if (repeatable === undefined || resolved.artworks.length === 0) {
    return [{ id: 'artwork-1', index: 0, slots: resolved.slots, adjustments: {} }];
  }

  return resolved.artworks.map((artwork) => ({
    id: `${repeatable}-${artwork.index + 1}`,
    index: artwork.index,
    slots: { ...resolved.slots, [repeatable]: artwork.slot },
    adjustments: flatten(artwork.slot),
  }));
}

export interface CompileOptions {
  /**
   * The project's `formats.yaml`. Required, because a `Frame` has a size and this is where
   * that number lives — a template states its layout, not its canvas.
   */
  readonly formats: FormatCatalogue;
  /**
   * The faces the scene's text can be measured against, so it is laid out here (ADR 0019).
   *
   * A cache rather than the `FontSource` port itself, because what `compile` needs is the
   * *capability* — "how wide is this string in this face" — and not the bytes behind it.
   * `createFaceCache(source)` is the bridge, and it is the adapter's job to call it; that
   * keeps one parse per scene instead of one per artwork, and it lets a pure test inject
   * arithmetic instead of a font.
   *
   * Optional, and its absence is not an error: without it every `TextNode` keeps exactly
   * the lines its template produced, which is what happened before anything measured. With
   * it, wrapping and `overflow: 'shrink'` are decided in the IR and both exporters draw the
   * same lines instead of each guessing.
   */
  readonly faces?: FaceCache;
}

export function compile(
  resolved: ResolvedBrief,
  template: Template,
  options: CompileOptions,
): Result<Scene, Diagnostics> {
  // Before anything is built: a format with no size cannot produce a frame, and finding
  // that out per artwork would report the same thing once per slide.
  const missing = undefinedFormats(options.formats, resolved.formats, template.manifest.name);
  if (missing.length > 0) return err(missing);

  const faces = options.faces;

  const plans = planArtworks(resolved, template);
  const problems: Diagnostic[] = [];
  const artworks: Artwork[] = [];
  const fonts = new Map<string, FontRef>();
  const assets = new Map<string, AssetRef>();

  for (const plan of plans) {
    const frames: Frame[] = [];

    for (const format of resolved.formats) {
      const context: TemplateContext = {
        format,
        // Defined: `undefinedFormats` above refused every format the catalogue lacks.
        size: options.formats.sizeOf(format) ?? { w: 0, h: 0 },
        idPrefix: idPrefixOf(plan.id, format),
        artwork: { id: plan.id, index: plan.index, count: plans.length },
        slots: plan.slots,
        adjustments: plan.adjustments,
      };

      let frame: Frame;
      try {
        frame = template.build(context);
      } catch (cause) {
        problems.push(crash(template.manifest.name, cause));
        continue;
      }

      // A template that returns the wrong frame has mixed up its own branches, and the
      // scene would render the story layout under the feed's name.
      if (frame.format !== format) {
        problems.push(
          diagnostic('E_TEMPLATE_CRASH', {
            template: template.manifest.name,
            problem: `asked for format '${format}' and returned '${frame.format}'`,
          }),
        );
        continue;
      }

      if (faces !== undefined) {
        frame = {
          ...frame,
          children: layoutText(frame.children, faces, plan.slots, format, problems),
        };
      }

      collect(frame.children, fonts, assets);
      for (const asset of paintAssets(frame.background)) assets.set(asset.id, asset);
      frames.push(frame);
    }

    artworks.push({ id: plan.id, frames });
  }

  // Errors replace the scene; warnings ride along with it (ADR 0013). Until text was
  // measured here nothing in this function produced a warning, so `problems.length > 0`
  // was the same test — `W_TEXT_OVERFLOW` is the first diagnostic a compile can emit and
  // still have something to hand back.
  if (problems.some(isError)) return err(problems);

  // Straight to `parseScene`: a template is code, and code that produces IR is exactly the
  // code whose output is validated rather than trusted (E2.1).
  return withWarnings(
    parseScene({
      version: 1,
      artworks,
      fonts: [...fonts.values()],
      assets: [...assets.values()],
    }),
    problems,
  );
}
