import type { SourceRange, TemplateManifest } from '@tyto/core';

import type { TemplateAttribute, TemplateDocument, TemplateElement } from './ast.js';
import type { Report } from './values.js';
import {
  ATTRIBUTES,
  type TagName,
  isTag,
  markupProblem,
  unsupportedAttribute,
  unsupportedTag,
} from './vocabulary.js';

/**
 * The markup, checked against the manifest and flattened into one frame per format.
 *
 * Everything here is decided once, when the template is compiled, and never again: which
 * tags exist, which attributes they take, which slot each one draws, and what `extends`
 * resolves to. `compile` calls a template once per (artwork, format) — six times for three
 * slides in two formats — and none of those calls should re-derive an answer that does not
 * depend on the brief.
 *
 * It is also what `tyto template check` reports. A template is checked without a brief, so
 * every question that can be answered without one has to be answered here rather than
 * where the values arrive.
 */

export function attributeOf(element: TemplateElement, name: string): TemplateAttribute | undefined {
  return element.attributes.find((attribute) => attribute.name === name);
}

export function classesOf(element: TemplateElement): string[] {
  const value = attributeOf(element, 'class')?.value ?? '';
  return value.split(/\s+/u).filter((name) => name !== '');
}

/** A `src` or `slot` that is exactly `{name}`, which is how markup names a slot. */
const WHOLE_INTERPOLATION = /^\{([a-zA-Z_][a-zA-Z0-9_-]*)\}$/u;
const ANY_INTERPOLATION = /\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/gu;

export function wholeSlotReference(value: string): string | undefined {
  return WHOLE_INTERPOLATION.exec(value)?.[1];
}

export function interpolatedSlots(value: string): string[] {
  return [...value.matchAll(ANY_INTERPOLATION)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

export interface FrameDefinition {
  readonly format: string;
  /** The tree this frame draws, which is its own or the one it extends. */
  readonly children: readonly TemplateElement[];
  readonly bg: TemplateAttribute | undefined;
  readonly range: SourceRange;
}

interface Declared {
  readonly element: TemplateElement;
  readonly format: string;
  readonly extends: TemplateAttribute | undefined;
  readonly bg: TemplateAttribute | undefined;
}

function checkElement(
  element: TemplateElement,
  manifest: TemplateManifest,
  report: Report,
  ids: Map<string, SourceRange>,
): void {
  if (!isTag(element.tag)) {
    report(unsupportedTag(element.tag, element.tagRange));
    return;
  }
  const tag: TagName = element.tag;

  if (tag === 'frame') {
    report(markupProblem('a <frame> is only written at the top level', element.tagRange));
    return;
  }
  if (tag !== 'group' && element.children.length > 0) {
    report(markupProblem(`a <${tag}> holds no other tags`, element.tagRange));
  }

  for (const attribute of element.attributes) {
    if (!ATTRIBUTES[tag].includes(attribute.name)) {
      report(unsupportedAttribute(attribute.name, tag, attribute.nameRange));
    }
  }

  const id = attributeOf(element, 'id');
  if (id !== undefined) {
    const first = ids.get(id.value);
    if (first === undefined) ids.set(id.value, id.valueRange);
    else report(markupProblem(`id '${id.value}' is used twice in one frame`, id.valueRange));
  }

  checkSlot(element, tag, manifest, report);

  if (tag === 'text' && attributeOf(element, 'slot') === undefined) {
    report(markupProblem('a <text> draws a slot, so it needs slot="…"', element.tagRange));
  }
  if (
    tag === 'image' &&
    attributeOf(element, 'slot') === undefined &&
    attributeOf(element, 'src') === undefined
  ) {
    report(markupProblem('an <image> needs slot="…" or src="…"', element.tagRange));
  }
  if (tag === 'vector' && attributeOf(element, 'src') === undefined) {
    report(markupProblem('a <vector> needs src="…" pointing at an SVG file', element.tagRange));
  }

  for (const child of element.children) checkElement(child, manifest, report, ids);
}

/** The type a tag can draw, so `slot="imagem"` on a `<text>` is caught before a brief is. */
const SLOT_TYPES: Partial<Record<TagName, 'rich-text' | 'image'>> = {
  text: 'rich-text',
  image: 'image',
};

function checkSlot(
  element: TemplateElement,
  tag: TagName,
  manifest: TemplateManifest,
  report: Report,
): void {
  const named = attributeOf(element, 'slot');
  const source = attributeOf(element, 'src');
  const references: { name: string; range: SourceRange; typed: boolean }[] = [];

  if (named !== undefined) {
    references.push({ name: named.value, range: named.valueRange, typed: true });
  }
  if (source !== undefined) {
    const whole = wholeSlotReference(source.value);
    for (const name of interpolatedSlots(source.value)) {
      references.push({ name, range: source.valueRange, typed: whole === name && tag === 'image' });
    }
  }

  for (const reference of references) {
    const slot = manifest.slots[reference.name];
    if (slot === undefined) {
      report(
        markupProblem(
          `slot '${reference.name}' is not declared by template '${manifest.name}', which declares ${Object.keys(manifest.slots).join(', ')}`,
          reference.range,
        ),
      );
      continue;
    }
    const wanted = SLOT_TYPES[tag];
    if (reference.typed && wanted !== undefined && slot.type !== wanted) {
      report(
        markupProblem(
          `<${tag}> draws a ${wanted} slot and '${reference.name}' is ${slot.type}`,
          reference.range,
        ),
      );
    }
  }
}

/**
 * `extends` resolved, and every format the manifest renders accounted for.
 *
 * A frame inherits the tree of the frame it extends and nothing else — the stylesheet is
 * already shared, and `@format story` is where the two are meant to differ. Inheriting the
 * `bg` too, unless the extending frame writes its own, is the one exception: a background
 * is written on the tag rather than in the stylesheet, so leaving it behind would make
 * `extends` silently drop it.
 */
export function collectFrames(
  document: TemplateDocument,
  manifest: TemplateManifest,
  report: Report,
): Map<string, FrameDefinition> {
  const declared = new Map<string, Declared>();

  for (const element of document.elements) {
    if (element.tag !== 'frame') {
      report(
        markupProblem(
          `the top level of a template holds <frame> tags, and this is <${element.tag}>`,
          element.tagRange,
        ),
      );
      continue;
    }

    for (const attribute of element.attributes) {
      if (!ATTRIBUTES.frame.includes(attribute.name)) {
        report(unsupportedAttribute(attribute.name, 'frame', attribute.nameRange));
      }
    }

    const format = attributeOf(element, 'format');
    if (format === undefined || format.value === '') {
      report(markupProblem('a <frame> needs format="…"', element.tagRange));
      continue;
    }
    if (!manifest.formats.includes(format.value)) {
      report(
        markupProblem(
          `frame format '${format.value}' is not one template '${manifest.name}' renders; it renders ${manifest.formats.join(', ')}`,
          format.valueRange,
        ),
      );
      continue;
    }
    if (declared.has(format.value)) {
      report(markupProblem(`two frames declare format '${format.value}'`, format.valueRange));
      continue;
    }

    const inherits = attributeOf(element, 'extends');
    if (inherits !== undefined && element.children.length > 0) {
      report(
        markupProblem(
          "a frame that extends another draws that frame's tree; give it children or an extends, not both",
          inherits.nameRange,
        ),
      );
      continue;
    }

    declared.set(format.value, {
      element,
      format: format.value,
      extends: inherits,
      bg: attributeOf(element, 'bg'),
    });

    const ids = new Map<string, SourceRange>();
    for (const child of element.children) checkElement(child, manifest, report, ids);
  }

  const frames = new Map<string, FrameDefinition>();

  for (const entry of declared.values()) {
    const resolved = resolveExtends(entry, declared, report);
    if (resolved === undefined) continue;
    frames.set(entry.format, {
      format: entry.format,
      children: resolved.element.children,
      bg: entry.bg ?? resolved.bg,
      range: entry.element.range,
    });
  }

  for (const format of manifest.formats) {
    if (frames.has(format)) continue;
    report(
      markupProblem(
        `template '${manifest.name}' renders format '${format}' and no frame declares it`,
        document.range,
      ),
    );
  }

  return frames;
}

function resolveExtends(
  entry: Declared,
  declared: ReadonlyMap<string, Declared>,
  report: Report,
): Declared | undefined {
  const seen = new Set<string>([entry.format]);
  let current = entry;

  while (current.extends !== undefined) {
    const parent = declared.get(current.extends.value);
    if (parent === undefined) {
      report(
        markupProblem(
          `extends names frame '${current.extends.value}', and no frame declares that format`,
          current.extends.valueRange,
        ),
      );
      return undefined;
    }
    if (seen.has(parent.format)) {
      report(
        markupProblem(
          `extends runs in a circle through '${parent.format}'`,
          current.extends.valueRange,
        ),
      );
      return undefined;
    }
    seen.add(parent.format);
    current = parent;
  }

  return current;
}
