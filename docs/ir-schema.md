# Scene IR — schema

Defined with Zod in `packages/core/src/scene/`. Types are inferred from the schema; never hand-write a parallel interface.

```ts
Scene    { version: 1; artworks: Artwork[]; fonts: FontRef[]; assets: AssetRef[] }
Artwork  { id: string; label?: string; frames: Frame[] }          // one Artwork per carousel slide
Frame    { format: string; size: {w,h}; background?: Paint; children: Node[] }  // no background ⇒ alpha

Node = Group | Rect | Text | Image | Vector       // tagged by `kind`
Base     { id; name?; kind; transform: Transform; opacity: 0..1; blend: BlendMode; visible: boolean;
           mask?: MaskRef; clip?: boolean; effects: Effect[] }
Group    extends Base { children: Node[] }
Rect     extends Base { size; radius: [tl,tr,br,bl]; fill?: Paint; stroke?: Stroke }
Text     extends Base { box: {w?, h?}; runs: TextRun[]; align; valign; lineHeight; letterSpacing; overflow: 'clip'|'shrink'|'grow' }
TextRun  = TextSpan{kind:'text', text, font: FontRef, size, weight, style, color: Paint, decoration?} | LineBreak{kind:'break'}
Image    extends Base { asset: AssetRef; size; fit: 'cover'|'contain'|'fill'; position }
Vector   extends Base { geometry: VectorGeometry; size; fill?; stroke? }

VectorGeometry = { kind: 'svg'; markup: string /* sanitized */ } | { kind: 'path'; d: string; fillRule }
Transform { x; y; rotation; scaleX; scaleY; anchor }
Color     { r: 0..255; g: 0..255; b: 0..255; a: 0..1 }
Paint     = Solid{color} | LinearGradient{angle, stops} | RadialGradient{center, radius, stops} | ImagePaint{asset, fit}
Stroke    { paint: Paint; width; align: 'inside'|'center'|'outside' }
Effect    = Shadow{x,y,blur,spread,color} | Blur{radius} | BackgroundBlur{radius}
MaskRef   { nodeId: string; mode: 'alpha'|'luminance' }     // a mask references another node
BlendMode = 'normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'soft-light'|'hard-light'|'difference'|'exclusion'|'hue'|'saturation'|'color'|'luminosity'
FontRef   { family; source: 'bundled'|'file'; path? }
AssetRef  { id; source: 'file'|'url'|'inline'; path?; hash }
```

`parseScene(input: unknown): Result<Scene, Diagnostic[]>` is the only way in. It validates the shape, then the invariants below, and reports everything it found rather than the first thing.

## Choices this document originally left open

The prose above is the contract; these are the decisions taken while writing the schema, recorded here so the next reader does not have to infer them from the code.

- **The root type is `Scene`, not `Document`.** Every port signature in `docs/architecture.md` already said `Scene`, and one name is worth more than fidelity to an earlier draft.
- **`kind` tags every node and every union member** (paints, effects, vector geometry). It lets Zod report `expected one of group, rect, text, image, vector` instead of every branch's complaints at once, and it lets `SceneVisitor` dispatch without `instanceof`.
- **Colour is structured, not a CSS string.** Exporters must never parse: SVG needs the channels for `rgba()`, the rasterizer multiplies alpha by inherited opacity. Whoever writes `#ff0000` writes it in a brief or a template, and the template SDK converts it.
- **Unknown keys are an error.** Every object is a Zod `strictObject`. A misspelled property in a template must reach its author, not be stripped on the way to an exporter that would then render something nobody asked for.
- **Fields that almost always take the same value carry a default** — `transform`, `opacity`, `blend`, `visible`, `clip`, `effects`, `letterSpacing`, `Color.a`, `Stroke.align`, `Image.position`, `fillRule`. Input may omit them; a parsed `Scene` always has them, so no exporter writes `?? 'normal'`.
- **`Vector.geometry` is a tagged union** rather than the spec's `svg | path` shorthand, so an exporter cannot mistake one for the other.
- **Gradients need at least two stops.** One stop is a solid paint written the long way.
- **A line break is a run, not a `
` inside one** (ADR 0016). `TextRun` is a tagged union,
  so an exporter dispatches on `kind` instead of scanning a string for breaks — the same
  reason colour is structured. Leading, trailing and consecutive breaks are all legal: an
  empty line is a thing an author asks for. A `LineBreak` carries no styling, because it
  has no glyph; the runs around it decide what the line looks like.

## Walking a scene

`SceneVisitor<T>` and `walk(scene, visitor)` in `packages/core/src/scene/visitor.ts` are the
only traversal of the IR. Every exporter implements the visitor; none of them writes the
recursion, the transform composition or the opacity product again, because two exporters
that disagree on any of those render the same scene two ways.

```ts
interface SceneVisitor<T> {
  group(node: GroupNode, context: VisitContext, children: readonly T[]): T;
  rect(node: RectNode, context: VisitContext): T;
  text(node: TextNode, context: VisitContext): T;
  image(node: ImageNode, context: VisitContext): T;
  vector(node: VectorNode, context: VisitContext): T;
}

VisitContext { scene; artwork; frame; format; ancestors: GroupNode[]; transform: Matrix; opacity; visible }
```

A visitor never recurses. `walk()` descends and hands `group()` what its children already
returned, which makes a visitor a fold over the tree rather than a callback that has to
remember where it is. `walk()` returns one `FrameVisit` per frame; `walkFrame()` does a
single frame, for an exporter that already picked one.

- **`context.transform` includes the node's own transform.** It maps the node's own
  coordinates onto the frame, which is what an exporter emits; a visitor that wants the
  parent's matrix reads it from `ancestors`. `Transform` is composed as a `Matrix`
  (`[a c e; b d f]`, SVG order) because two nested rotations around different anchors are
  not a third rotation around a third anchor.
- **`context.opacity` is the product from the frame down to and including the node**, and
  is independent of `visible` — an exporter that needs them combined combines them.
- **A hidden node is visited.** `context.visible` is false when the node or any ancestor
  is invisible, and the walk continues into it anyway: the badge mask in
  `valid-promo.json` is `visible: false` and exists only to be rendered into a `<mask>`.
  Skipping belongs to the visitor that knows why it is walking.
- **`Transform.anchor` is resolved against the node's own declared box.** A group has no
  box and a text may leave a dimension to its content, so both anchor at their origin.
  Resolving them properly means measuring laid-out text, which the IR does not record and
  E4.5 is where it arrives.

`invariants.ts` is a caller: each rule wants the same flat list of nodes, and "is this
node inside that one" is the ancestor chain read from the other side.

### Bounds

`bounds.ts` is the other caller and the first shipped visitor. `frameBounds(scene, artwork,
frame)` and `sceneBounds(scene)` give the axis-aligned box the visible nodes occupy, in
frame coordinates — a `viewBox`, a crop-to-content export, the question E4.5 asks about a
text. `boundsVisitor` and `unionBounds` are exported too, for a caller that wants bounds
per node id or wants hidden nodes counted after all.

- **These are layout bounds, not ink bounds.** A stroke aligned `outside` paints half a
  stroke width past the box and a shadow paints wherever its offset and blur put it;
  neither is counted. Both are computable from the node, so the visitor that needs them
  wraps this one instead of every caller paying for them.
- **`Bounds.exact` is false when some node did not fully declare its own box** — a text
  with an absent `box.w` or `box.h`, or one whose `overflow` is `grow`. The real box is
  then at least that large and never smaller, and the flag travels up through
  `unionBounds`. It is the honest form of the hole that stays open until E4.5 measures
  laid-out text; a caller that must not clip pads or waits.
- **A hidden node bounds to `undefined`**, and so does a frame that draws nothing.

## Exporter mapping

| IR                       | HTML/CSS                                          | SVG                                                                           |
| ------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Frame without background | `omitBackground` in raster                        | no background `<rect>`                                                        |
| Group.opacity/blend      | `opacity`, `mix-blend-mode`                       | `<g opacity>` + `style="mix-blend-mode"`                                      |
| mask                     | `mask-image` (mask node rendered as SVG data URI) | `<mask>`                                                                      |
| clip                     | `overflow: hidden`                                | `<clipPath>`                                                                  |
| Shadow/Blur              | `filter: drop-shadow()/blur()`                    | `<filter>`                                                                    |
| Text                     | `div` + spans; bundled `@font-face`               | `<text>`+`<tspan>`; font embedded in `<style>` or converted to paths (option) |
| TextRun `break`          | `<br>`                                            | ends the `<tspan>`; the next one starts at `x` with `dy` of one line          |
| Vector.svg               | inline `<svg>`                                    | inline (namespaces normalized)                                                |

## Invariants (tested in `core`)

Checked in `scene/invariants.ts`, after the shape holds. Each one names the id at fault, because a Zod path like `artworks.0.frames.1.children.4` is not something a template author can search for.

- `id` unique per Scene. Artwork ids and node ids share one id space — "unique per document" reads across the whole document.
- `mask.nodeId` points to an existing node that is not a descendant of the masked node. A node masked by its own child would have to be rendered to produce the mask that decides how it is rendered.
- Referenced fonts exist in `Scene.fonts`; assets in `Scene.assets`. An `ImagePaint` counts as an asset reference wherever it appears, including a frame background — which is blamed on `<artwork id>:<format>`, having no node id of its own.
- No Text without at least one `kind: 'text'` run. Empty `runs`, or runs that are all line breaks, draw the same amount: nothing.
