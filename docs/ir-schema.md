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
TextRun  { text; font: FontRef; size; weight; style; color: Paint; decoration? }
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

## Exporter mapping

| IR                       | HTML/CSS                                          | SVG                                                                           |
| ------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Frame without background | `omitBackground` in raster                        | no background `<rect>`                                                        |
| Group.opacity/blend      | `opacity`, `mix-blend-mode`                       | `<g opacity>` + `style="mix-blend-mode"`                                      |
| mask                     | `mask-image` (mask node rendered as SVG data URI) | `<mask>`                                                                      |
| clip                     | `overflow: hidden`                                | `<clipPath>`                                                                  |
| Shadow/Blur              | `filter: drop-shadow()/blur()`                    | `<filter>`                                                                    |
| Text                     | `div` + spans; bundled `@font-face`               | `<text>`+`<tspan>`; font embedded in `<style>` or converted to paths (option) |
| Vector.svg               | inline `<svg>`                                    | inline (namespaces normalized)                                                |

## Invariants (tested in `core`)

Checked in `scene/invariants.ts`, after the shape holds. Each one names the id at fault, because a Zod path like `artworks.0.frames.1.children.4` is not something a template author can search for.

- `id` unique per Scene. Artwork ids and node ids share one id space — "unique per document" reads across the whole document.
- `mask.nodeId` points to an existing node that is not a descendant of the masked node. A node masked by its own child would have to be rendered to produce the mask that decides how it is rendered.
- Referenced fonts exist in `Scene.fonts`; assets in `Scene.assets`. An `ImagePaint` counts as an asset reference wherever it appears, including a frame background — which is blamed on `<artwork id>:<format>`, having no node id of its own.
- No Text with empty `runs`.
