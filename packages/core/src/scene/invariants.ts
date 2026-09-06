import type { SceneNode } from './nodes.js';
import type { Paint } from './primitives.js';
import type { Artwork, Frame, Scene } from './scene.js';
import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';

/**
 * The four rules `docs/ir-schema.md` states that a schema cannot: they are about how parts
 * of a scene relate, and Zod only sees one value at a time.
 *
 * Every check reports the id of the node at fault. A path like
 * `artworks.0.frames.1.children.4` is what Zod can offer and is useless to whoever wrote
 * the template — the id is the thing they can search for.
 *
 * The traversal here is local and private. `SceneVisitor` and `walk()` arrive in E2.2 and
 * this file becomes one of their callers; building the visitor now would be doing that
 * card's work with none of its tests.
 */

interface NodeRecord {
  readonly node: SceneNode;
  /** Ids below this node, excluding its own — what the mask rule needs. */
  readonly descendantIds: ReadonlySet<string>;
}

function collect(node: SceneNode, into: NodeRecord[]): Set<string> {
  const below = new Set<string>();
  if (node.kind === 'group') {
    for (const child of node.children) {
      for (const id of collect(child, into)) below.add(id);
    }
  }
  // Pushed before the node adds itself, so `descendantIds` never contains the node.
  into.push({ node, descendantIds: new Set(below) });
  below.add(node.id);
  return below;
}

function recordsOf(scene: Scene): NodeRecord[] {
  const records: NodeRecord[] = [];
  for (const artwork of scene.artworks) {
    for (const frame of artwork.frames) {
      for (const child of frame.children) collect(child, records);
    }
  }
  return records;
}

/** Every asset a paint pulls in; only `image` paints reference one. */
function paintAssetIds(paint: Paint | undefined): string[] {
  return paint?.kind === 'image' ? [paint.asset.id] : [];
}

/** Every asset a node pulls in, through its own fields and through its paints. */
function nodeAssetIds(node: SceneNode): string[] {
  switch (node.kind) {
    case 'image':
      return [node.asset.id];
    case 'rect':
      return [...paintAssetIds(node.fill), ...paintAssetIds(node.stroke?.paint)];
    case 'vector':
      return [...paintAssetIds(node.fill), ...paintAssetIds(node.stroke?.paint)];
    case 'text':
      return node.runs.flatMap((run) => paintAssetIds(run.color));
    case 'group':
      return [];
  }
}

function duplicateIds(scene: Scene, records: readonly NodeRecord[]): Diagnostic[] {
  const counts = new Map<string, number>();
  // Artwork ids share the id space with node ids: the spec says unique per document, and
  // a document is the whole thing.
  const ids = [...scene.artworks.map((artwork) => artwork.id), ...records.map((r) => r.node.id)];
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => diagnostic('E_SCENE_DUPLICATE_ID', { id, count }));
}

function maskProblems(records: readonly NodeRecord[]): Diagnostic[] {
  const nodeIds = new Set(records.map((record) => record.node.id));

  return records.flatMap(({ node, descendantIds }) => {
    const { mask } = node;
    if (!mask) return [];
    if (!nodeIds.has(mask.nodeId)) {
      return [diagnostic('E_SCENE_MASK_NOT_FOUND', { id: node.id, maskId: mask.nodeId })];
    }
    if (descendantIds.has(mask.nodeId)) {
      // A node masked by its own child would have to be rendered to produce the mask that
      // decides how it is rendered.
      return [diagnostic('E_SCENE_MASK_DESCENDANT', { id: node.id, maskId: mask.nodeId })];
    }
    return [];
  });
}

function undeclaredFonts(scene: Scene, records: readonly NodeRecord[]): Diagnostic[] {
  const declared = new Set(scene.fonts.map((font) => font.family));

  return records.flatMap(({ node }) => {
    if (node.kind !== 'text') return [];
    const missing = new Set(
      node.runs.map((run) => run.font.family).filter((family) => !declared.has(family)),
    );
    return [...missing].map((family) =>
      diagnostic('E_SCENE_FONT_NOT_DECLARED', { id: node.id, family }),
    );
  });
}

function undeclaredAssets(scene: Scene, records: readonly NodeRecord[]): Diagnostic[] {
  const declared = new Set(scene.assets.map((asset) => asset.id));

  const fromNodes = records.flatMap(({ node }) => {
    const missing = new Set(nodeAssetIds(node).filter((id) => !declared.has(id)));
    return [...missing].map((assetId) =>
      diagnostic('E_SCENE_ASSET_NOT_DECLARED', { id: node.id, assetId }),
    );
  });

  // A frame background is a paint without a node to blame, so it is named by the artwork
  // and format it belongs to.
  const fromBackgrounds = scene.artworks.flatMap((artwork: Artwork) =>
    artwork.frames.flatMap((frame: Frame) =>
      paintAssetIds(frame.background)
        .filter((assetId) => !declared.has(assetId))
        .map((assetId) =>
          diagnostic('E_SCENE_ASSET_NOT_DECLARED', {
            id: `${artwork.id}:${frame.format}`,
            assetId,
          }),
        ),
    ),
  );

  return [...fromNodes, ...fromBackgrounds];
}

function emptyText(records: readonly NodeRecord[]): Diagnostic[] {
  return records
    .filter(({ node }) => node.kind === 'text' && node.runs.length === 0)
    .map(({ node }) => diagnostic('E_SCENE_EMPTY_TEXT', { id: node.id }));
}

/**
 * Runs every rule and returns everything wrong, rather than stopping at the first —
 * a scene is usually fixed in one editing pass, not one problem per compile.
 */
export function sceneInvariants(scene: Scene): readonly Diagnostic[] {
  const records = recordsOf(scene);
  return [
    ...duplicateIds(scene, records),
    ...maskProblems(records),
    ...undeclaredFonts(scene, records),
    ...undeclaredAssets(scene, records),
    ...emptyText(records),
  ];
}
