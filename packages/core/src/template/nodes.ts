import { type NonEmpty } from './values.js';
import type {
  GroupNode,
  ImageNode,
  RectNode,
  SceneNode,
  TextAlign,
  TextNode,
  TextOverflow,
  TextRun,
  TextVerticalAlign,
  VectorGeometry,
  VectorNode,
} from '../scene/nodes.js';
import {
  type AssetRef,
  type Effect,
  type Fit,
  type MaskRef,
  type Paint,
  type Size,
  type Stroke,
  type Transform,
  type UnitPoint,
  identityTransform,
} from '../scene/primitives.js';
import type { Frame } from '../scene/scene.js';

/**
 * The node builders a `template.ts` writes against (`docs/template-authoring.md`).
 *
 * Their whole job is that a template says what is different and nothing else. The IR
 * requires a transform, an opacity, a blend mode, a visibility, a clip flag and an effect
 * list on every node; a template that means "a white rect at 64, 64" should write that
 * and no more, and these fill the rest with the values `docs/ir-schema.md` calls the
 * defaults.
 *
 * They do not validate. Zod is the validator and `parseScene` is where it runs — a
 * builder that re-checked its own arguments would be a second, drifting copy of the
 * schema. What the builders do instead is make the invalid unwritable: a text with no
 * runs and a gradient with one stop are type errors, not diagnostics.
 */

/**
 * A node on its way to a frame: everything filled except the id.
 *
 * Ids are the one thing a builder cannot decide alone. A generated id has to be stable
 * across runs (determinism, `docs/architecture.md`) and unique across the scene, and a
 * builder knows neither where it sits nor what else exists. `frame()` does know, so it
 * assigns them, and until then a node is a draft.
 */
export type NodeDraft = GroupDraft | RectDraft | TextDraft | ImageDraft | VectorDraft;

type Drafted<Node> = Omit<Node, 'id'> & { readonly id?: string };

export type RectDraft = Drafted<RectNode>;
export type TextDraft = Drafted<TextNode>;
export type ImageDraft = Drafted<ImageNode>;
export type VectorDraft = Drafted<VectorNode>;
export type GroupDraft = Omit<Drafted<GroupNode>, 'children'> & {
  readonly children: readonly NodeDraft[];
};

/** What every builder accepts, because every node in the IR carries it. */
export interface NodeOptions {
  /** Omit it and `frame()` derives one from the node's position. */
  readonly id?: string;
  readonly name?: string;
  /** Only the parts that differ from the identity; the rest is filled in. */
  readonly transform?: Partial<Transform>;
  readonly opacity?: number;
  readonly blend?: SceneNode['blend'];
  readonly visible?: boolean;
  readonly mask?: MaskRef;
  readonly clip?: boolean;
  readonly effects?: readonly Effect[];
}

/** The IR defaults from `docs/ir-schema.md`, applied once here instead of per builder. */
function base(options: NodeOptions): Omit<RectNode, 'id' | 'kind' | 'size' | 'radius'> {
  return {
    transform: { ...identityTransform, ...options.transform },
    opacity: options.opacity ?? 1,
    blend: options.blend ?? 'normal',
    visible: options.visible ?? true,
    clip: options.clip ?? false,
    effects: [...(options.effects ?? [])],
    // Spread rather than assigned undefined: exactOptionalPropertyTypes tells an absent
    // key apart from an undefined one, and a strictObject rejects the latter.
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.mask !== undefined ? { mask: options.mask } : {}),
  };
}

export interface RectOptions extends NodeOptions {
  readonly size: Size;
  /** One number for all four corners, or `[tl, tr, br, bl]` like CSS. Defaults to 0. */
  readonly radius?: number | readonly [number, number, number, number];
  readonly fill?: Paint;
  readonly stroke?: Stroke;
}

export function rect(options: RectOptions): RectDraft {
  const radius = options.radius ?? 0;
  return {
    ...base(options),
    kind: 'rect',
    size: options.size,
    radius: typeof radius === 'number' ? [radius, radius, radius, radius] : [...radius],
    ...(options.id !== undefined ? { id: options.id } : {}),
    ...(options.fill !== undefined ? { fill: options.fill } : {}),
    ...(options.stroke !== undefined ? { stroke: options.stroke } : {}),
  };
}

export interface TextOptions extends NodeOptions {
  /**
   * At least one run, enforced by the type: `E_SCENE_EMPTY_TEXT` exists for scenes that
   * arrive from somewhere else, and a template should never be able to produce one.
   */
  readonly runs: NonEmpty<TextRun>;
  /** An absent dimension means "as large as the content needs". Defaults to both absent. */
  readonly box?: { readonly w?: number; readonly h?: number };
  readonly align?: TextAlign;
  readonly valign?: TextVerticalAlign;
  /** A multiplier of the run's font size. Defaults to 1.2, the usual body leading. */
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly overflow?: TextOverflow;
}

export function text(options: TextOptions): TextDraft {
  return {
    ...base(options),
    kind: 'text',
    runs: [...options.runs],
    box: {
      ...(options.box?.w !== undefined ? { w: options.box.w } : {}),
      ...(options.box?.h !== undefined ? { h: options.box.h } : {}),
    },
    align: options.align ?? 'left',
    valign: options.valign ?? 'top',
    lineHeight: options.lineHeight ?? 1.2,
    letterSpacing: options.letterSpacing ?? 0,
    // `clip` is the only overflow that needs no measurement, so it is what a template
    // that says nothing gets; `shrink` and `grow` are choices, and E4.5 acts on them.
    overflow: options.overflow ?? 'clip',
    ...(options.id !== undefined ? { id: options.id } : {}),
  };
}

export interface ImageOptions extends NodeOptions {
  readonly asset: AssetRef;
  readonly size: Size;
  readonly fit?: Fit;
  /** Focal point kept in frame when `fit` crops. Defaults to the centre. */
  readonly position?: UnitPoint;
}

export function image(options: ImageOptions): ImageDraft {
  return {
    ...base(options),
    kind: 'image',
    asset: options.asset,
    size: options.size,
    fit: options.fit ?? 'cover',
    position: options.position ?? { x: 0.5, y: 0.5 },
    ...(options.id !== undefined ? { id: options.id } : {}),
  };
}

export interface VectorOptions extends NodeOptions {
  /** `{ kind: 'svg', markup }` or `{ kind: 'path', d }`; markup is sanitized upstream. */
  readonly geometry: VectorGeometry;
  readonly size: Size;
  readonly fill?: Paint;
  readonly stroke?: Stroke;
}

export function vector(options: VectorOptions): VectorDraft {
  return {
    ...base(options),
    kind: 'vector',
    geometry: options.geometry,
    size: options.size,
    ...(options.id !== undefined ? { id: options.id } : {}),
    ...(options.fill !== undefined ? { fill: options.fill } : {}),
    ...(options.stroke !== undefined ? { stroke: options.stroke } : {}),
  };
}

export interface GroupOptions extends NodeOptions {
  readonly children: readonly NodeDraft[];
}

export function group(options: GroupOptions): GroupDraft {
  return {
    ...base(options),
    kind: 'group',
    children: [...options.children],
    ...(options.id !== undefined ? { id: options.id } : {}),
  };
}

/**
 * Fills in every id a draft left out, from the node's position in the tree.
 *
 * The segment is the node's own id when it has one, so `group({ id: 'copy' })` gives its
 * first child `copy.0` and reordering something above it changes nothing. A generated id
 * reads as a path — `feed.1.0` — because the invariants blame nodes by id and a path is
 * what an author can find.
 */
function assignIds(drafts: readonly NodeDraft[], prefix: string): SceneNode[] {
  return drafts.map((draft, index): SceneNode => {
    const id = draft.id ?? `${prefix}.${index}`;
    // Spelled out per kind rather than folded into one generic: `Omit` over a union
    // collapses it to the keys they share, and a rect stops being a rect.
    switch (draft.kind) {
      case 'group':
        return { ...draft, id, children: assignIds(draft.children, id) };
      case 'rect':
        return { ...draft, id };
      case 'text':
        return { ...draft, id };
      case 'image':
        return { ...draft, id };
      case 'vector':
        return { ...draft, id };
    }
  });
}

export interface FrameOptions {
  /** A format name from the manifest, such as `feed` or `story`. */
  readonly format: string;
  readonly size: Size;
  /** No background means transparent; the rasterizer omits it rather than painting white. */
  readonly background?: Paint;
  readonly children?: readonly NodeDraft[];
  /**
   * Namespace for the ids this call generates, defaulting to the format.
   *
   * Ids must be unique across the whole scene, and a frame only knows its own subtree —
   * two artworks each with a `feed` frame would generate `feed.0` twice. The default is
   * therefore only unique *within* an artwork; whoever assembles artworks into a scene
   * (E4.2) passes the artwork id here, and `parseScene` reports it as
   * `E_SCENE_DUPLICATE_ID` if nobody does.
   */
  readonly idPrefix?: string;
}

/**
 * A frame, and the point where drafts become IR: the ids are assigned here.
 *
 * A frame is not a node — it has no transform and no opacity, only a size and a
 * background — so it takes no `NodeOptions`.
 */
export function frame(options: FrameOptions): Frame {
  return {
    format: options.format,
    size: options.size,
    children: assignIds(options.children ?? [], options.idPrefix ?? options.format),
    ...(options.background !== undefined ? { background: options.background } : {}),
  };
}
