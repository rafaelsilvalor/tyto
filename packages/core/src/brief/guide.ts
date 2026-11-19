import type { ResolvedSlot } from './resolve.js';
import { type Bounds, boundsVisitor } from '../scene/bounds.js';
import { externalArtPlaceholder, externalArtSlotOf } from '../scene/external-art.js';
import { GAP_COLOR } from '../scene/gap.js';
import type { FrameGuide, GuideBox, GuideLayer } from '../scene/guide.js';
import type { RectNode, SceneNode, TextNode, TextSpan } from '../scene/nodes.js';
import { type Paint, type Size, identityTransform } from '../scene/primitives.js';
import type { Artwork, Frame } from '../scene/scene.js';
import { type SceneVisitor, walkFrame } from '../scene/visitor.js';
import type { FaceCache } from '../text/face.js';
import { measureText } from '../text/layout.js';
import { type TemplateManifest, externalArtSize } from '../template/manifest.js';

/**
 * The guide's Scene (ADR 0220, TYTO-740): the template's own frame, cut into the layers a
 * designer paints between.
 *
 * `compile(..., { guide: true })` runs the one layout path every render runs. This module is
 * what it adds around that path: every external slot left empty, so its place is the box ADR
 * 0220 draws; one outlined, named area per node a text or picture slot produced, from the real
 * layout boxes; the frame's `guide`, saying which top-level node goes in which layer; and one
 * empty canvas per `inline` slot. A slot's provenance exists only inside `compile` (the runs'
 * origins, the slots' assets), which is why this happens there and not in an exporter.
 */

/** `slots` with every external slot's value a placeholder: in a guide the art is to paint. */
export function withExternalArtEmptied(
  slots: Readonly<Record<string, ResolvedSlot>>,
  manifest: TemplateManifest,
): Readonly<Record<string, ResolvedSlot>> {
  let emptied: Record<string, ResolvedSlot> | undefined;
  for (const [name, slot] of Object.entries(slots)) {
    if (manifest.slots[name]?.external === undefined || slot.value.kind !== 'image') continue;
    if (externalArtSlotOf(slot.value.asset) !== undefined) continue;
    emptied ??= { ...slots };
    emptied[name] = { ...slot, value: { kind: 'image', asset: externalArtPlaceholder(name) } };
  }
  return emptied ?? slots;
}

/** Every image a slot holds, by asset id: nested slots, list values and a slide's pictures. */
function slotImages(
  slots: Readonly<Record<string, ResolvedSlot>>,
  found: Map<string, string>,
): Map<string, string> {
  for (const slot of Object.values(slots)) {
    const blocks = (slot.blocks ?? []).flatMap((block) =>
      block.kind === 'slot' ? [block.slot] : [],
    );
    for (const value of [slot, ...(slot.occurrences ?? []), ...blocks]) {
      if (value.value.kind === 'image' && !found.has(value.value.asset.id)) {
        found.set(value.value.asset.id, value.name);
      }
      if (value.slots !== undefined) slotImages(value.slots, found);
    }
  }
  return found;
}

/**
 * The slot each node of a built frame came from, by node id: a text by its runs' origin, a
 * picture by its asset. Read before layout, which replaces the runs that carry the origin.
 * A placeholder of external art is not here: its box is already the slot's area.
 */
export function slotNodesOf(
  nodes: readonly SceneNode[],
  slots: Readonly<Record<string, ResolvedSlot>>,
  textSlotOf: (node: TextNode) => string | undefined,
  images: Map<string, string> = slotImages(slots, new Map()),
  found: Map<string, string> = new Map(),
): Map<string, string> {
  for (const node of nodes) {
    if (node.kind === 'group') slotNodesOf(node.children, slots, textSlotOf, images, found);
    if (node.kind === 'text') {
      const slot = textSlotOf(node);
      if (slot !== undefined) found.set(node.id, slot);
    }
    if (node.kind === 'image' && externalArtSlotOf(node.asset) === undefined) {
      const slot = images.get(node.asset.id);
      if (slot !== undefined) found.set(node.id, slot);
    }
  }
  return found;
}

function placeholderIn(paint: Paint | undefined): string | undefined {
  return paint?.kind === 'image' ? externalArtSlotOf(paint.asset) : undefined;
}

/** The external slot a node or anything under it draws the placeholder of, if any. */
function externalSlotUnder(node: SceneNode): string | undefined {
  switch (node.kind) {
    case 'group':
      for (const child of node.children) {
        const slot = externalSlotUnder(child);
        if (slot !== undefined) return slot;
      }
      return undefined;
    case 'image':
      return externalArtSlotOf(node.asset);
    case 'rect':
    case 'vector':
      return placeholderIn(node.fill) ?? placeholderIn(node.stroke?.paint);
    case 'text':
      return undefined;
  }
}

/**
 * Which top-level child holds which external slot's box, by id, read before
 * `withExternalArtBoxes` swaps them. A frame background painted with a placeholder becomes
 * the box that function prepends, under the id it gives it.
 */
export function externalNodesOf(frame: Frame, idPrefix: string): Map<string, string> {
  const found = new Map<string, string>();
  const background = placeholderIn(frame.background);
  if (background !== undefined) found.set(`${idPrefix}.external-art-${background}`, background);
  for (const child of frame.children) {
    const slot = externalSlotUnder(child);
    if (slot !== undefined) found.set(child.id, slot);
  }
  return found;
}

/** Fills a text's open dimensions, so a text left to its content still has an area. */
function filledText(node: TextNode, faces: FaceCache | undefined): TextNode {
  if (node.box.w !== undefined && node.box.h !== undefined && node.overflow !== 'grow') return node;
  const measured = faces === undefined ? undefined : measureText(node, faces);
  const largest = Math.max(0, ...node.runs.map((run) => (run.kind === 'break' ? 0 : run.size)));
  const lines = node.runs.filter((run) => run.kind === 'break').length + 1;
  const height = measured?.height ?? node.lineHeight * largest * lines;
  return {
    ...node,
    box: {
      w: node.box.w ?? measured?.width ?? 0,
      h: Math.max(node.box.h ?? 0, height),
    },
  };
}

/** Each node's layout box in frame coordinates, by id (`bounds.ts`). Hidden nodes have none. */
function boxesOf(frame: Frame, faces: FaceCache | undefined): Map<string, Bounds> {
  const boxes = new Map<string, Bounds>();
  const keep = (id: string, bounds: Bounds | undefined): Bounds | undefined => {
    if (bounds !== undefined) boxes.set(id, bounds);
    return bounds;
  };
  const visitor: SceneVisitor<Bounds | undefined> = {
    group: (node, context, children) => keep(node.id, boundsVisitor.group(node, context, children)),
    rect: (node, context) => keep(node.id, boundsVisitor.rect(node, context)),
    image: (node, context) => keep(node.id, boundsVisitor.image(node, context)),
    vector: (node, context) => keep(node.id, boundsVisitor.vector(node, context)),
    text: (node, context) => keep(node.id, boundsVisitor.text(filledText(node, faces), context)),
  };
  // The walk wants a scene and an artwork for its context; nothing here reads them.
  const artwork: Artwork = { id: 'guide', frames: [frame] };
  walkFrame({ version: 1, artworks: [artwork], fonts: [], assets: [] }, artwork, frame, visitor);
  return boxes;
}

function boxOf(bounds: Bounds): GuideBox {
  return {
    x: bounds.minX,
    y: bounds.minY,
    w: bounds.maxX - bounds.minX,
    h: bounds.maxY - bounds.minY,
  };
}

/** The first span of the frame's text: the label draws in a face the template already uses. */
function firstSpan(nodes: readonly SceneNode[]): TextSpan | undefined {
  for (const node of nodes) {
    if (node.kind === 'group') {
      const span = firstSpan(node.children);
      if (span !== undefined) return span;
    }
    if (node.kind === 'text') {
      const span = node.runs.find((run): run is TextSpan => run.kind === 'text');
      if (span !== undefined) return span;
    }
  }
  return undefined;
}

/** The outline's width: the external art box's own rule, so the guide reads as one system. */
function outlineWidth(size: Size): number {
  return Math.max(2, Math.round(Math.min(size.w, size.h) / 120));
}

/** An area's outline and its label, named by its slot, in frame coordinates. */
function areaNodes(
  id: string,
  slot: string,
  box: GuideBox,
  span: TextSpan | undefined,
): SceneNode[] {
  const color: Paint = { kind: 'solid', color: GAP_COLOR };
  const width = outlineWidth({ w: box.w, h: box.h });
  const outline: RectNode = {
    id: `${id}.area`,
    name: slot,
    kind: 'rect',
    transform: { ...identityTransform, x: box.x, y: box.y },
    opacity: 1,
    blend: 'normal',
    visible: true,
    clip: false,
    effects: [],
    size: { w: box.w, h: box.h },
    radius: [0, 0, 0, 0],
    stroke: { paint: color, width, align: 'inside' },
  };
  // No face in the frame to draw a label with: the outline alone, still named by the slot.
  if (span === undefined) return [outline];
  const { decoration: _decoration, ...plain } = span;
  const label: TextNode = {
    id: `${id}.area-label`,
    name: slot,
    kind: 'text',
    transform: { ...identityTransform, x: box.x + width * 2, y: box.y + width * 2 },
    opacity: 1,
    blend: 'normal',
    visible: true,
    clip: false,
    effects: [],
    box: { w: Math.max(0, box.w - width * 4) },
    runs: [{ ...plain, text: slot, size: 20, color }],
    align: 'left',
    valign: 'top',
    lineHeight: 1.2,
    letterSpacing: 0,
    overflow: 'grow',
  };
  return [outline, label];
}

/**
 * `frame` with an area appended for every node `slotNodes` names, over everything else, and
 * the ids it appended. A node with no visible box (hidden, or nothing drawn) has no area.
 */
export function withGuideAreas(
  frame: Frame,
  slotNodes: ReadonlyMap<string, string>,
  faces: FaceCache | undefined,
): { readonly frame: Frame; readonly areas: readonly string[] } {
  const boxes = boxesOf(frame, faces);
  const span = firstSpan(frame.children);
  const appended = [...slotNodes].flatMap(([id, slot]) => {
    const bounds = boxes.get(id);
    return bounds === undefined ? [] : areaNodes(id, slot, boxOf(bounds), span);
  });
  return {
    frame: { ...frame, children: [...frame.children, ...appended] },
    areas: appended.map((node) => node.id),
  };
}

function layer(
  name: GuideLayer['name'],
  nodes: readonly string[],
  options: Partial<GuideLayer> = {},
): GuideLayer {
  return {
    name,
    label: name,
    nodes: [...nodes],
    locked: true,
    visible: true,
    opacity: 1,
    ...options,
  };
}

/**
 * The frame's art: the first `full` external slot in manifest order with a box in the frame,
 * else the first `inline` one. A template with two `full` slots paints the second as an area.
 */
function artOf(
  external: ReadonlyMap<string, string>,
  manifest: TemplateManifest,
): { readonly id: string; readonly slot: string; readonly kind: 'full' | 'inline' } | undefined {
  for (const kind of ['full', 'inline'] as const) {
    for (const [slot, declared] of Object.entries(manifest.slots)) {
      if (declared.external?.kind !== kind) continue;
      const id = [...external].find(([, owner]) => owner === slot)?.[0];
      if (id !== undefined) return { id, slot, kind };
    }
  }
  return undefined;
}

/**
 * The frame's layers, top to bottom (ADR 0220): `texto`, every top-level node painted above
 * the art; `areas`, the external boxes and the appended areas, at half opacity; `arte`,
 * empty, where the designer paints; `decoracao`, every node painted under the art, hidden.
 * A node is placed by its top-level ancestor, so a group holding the art holds its place.
 */
export function guideOf(
  frame: Frame,
  external: ReadonlyMap<string, string>,
  areas: readonly string[],
  manifest: TemplateManifest,
  faces: FaceCache | undefined,
): FrameGuide {
  const art = artOf(external, manifest);
  const inAreas = new Set([...external.keys(), ...areas]);
  const ids = frame.children.map((child) => child.id);
  const artIndex = art === undefined ? -1 : ids.indexOf(art.id);
  const above = ids.filter((id, index) => !inAreas.has(id) && index > artIndex);
  const under = ids.filter((id, index) => !inAreas.has(id) && index < artIndex);
  const bounds = art === undefined ? undefined : boxesOf(frame, faces).get(art.id);
  return {
    ...(art === undefined
      ? {}
      : {
          art: {
            slot: art.slot,
            kind: art.kind,
            box: bounds === undefined ? { x: 0, y: 0, w: 0, h: 0 } : boxOf(bounds),
          },
        }),
    layers: [
      layer('texto', above),
      layer(
        'areas',
        ids.filter((id) => inAreas.has(id)),
        { opacity: 0.5 },
      ),
      layer('arte', [], { locked: false }),
      layer('decoracao', under, { visible: false }),
    ],
  };
}

/**
 * One empty canvas per `inline` slot (ADR 0220): an artwork of its own, a frame per format at
 * the declared width × suggested height, with only the `arte` layer, named with the width.
 */
export function inlineArtCanvases(
  manifest: TemplateManifest,
  formats: readonly string[],
): Artwork[] {
  return Object.entries(manifest.slots).flatMap(([slot, declared]) => {
    if (declared.external?.kind !== 'inline') return [];
    const frames = formats.flatMap((format): Frame[] => {
      const size = externalArtSize(declared, format);
      if (size === undefined) return [];
      return [
        {
          format,
          size,
          children: [],
          guide: {
            art: { slot, kind: 'inline', box: { x: 0, y: 0, w: size.w, h: size.h } },
            layers: [layer('arte', [], { label: `arte ${String(size.w)}px`, locked: false })],
          },
        },
      ];
    });
    return [{ id: `external-art-${slot}`, label: slot, frames }];
  });
}
