# Scene IR — schema

Defined with Zod in `packages/core/src/scene/`. Types are inferred from the schema; never hand-write a parallel interface.

```ts
Document { version: 1; artworks: Artwork[]; fonts: FontRef[]; assets: AssetRef[] }
Artwork  { id: string; label?: string; frames: Frame[] }          // one Artwork per carousel slide
Frame    { format: string; size: {w,h}; background?: Paint; children: Node[] }  // no background ⇒ alpha

Node = Group | Rect | Text | Image | Vector
Base     { id; name?; transform: Transform; opacity: 0..1; blend: BlendMode; visible: boolean;
           mask?: MaskRef; clip?: boolean; effects: Effect[] }
Group    extends Base { children: Node[] }
Rect     extends Base { size; radius: [tl,tr,br,bl]; fill?: Paint; stroke?: Stroke }
Text     extends Base { box: {w?, h?}; runs: TextRun[]; align; valign; lineHeight; letterSpacing; overflow: 'clip'|'shrink'|'grow' }
TextRun  { text; font: FontRef; size; weight; style; color: Paint; decoration? }
Image    extends Base { asset: AssetRef; size; fit: 'cover'|'contain'|'fill'; position }
Vector   extends Base { svg: string /* sanitized markup */ | path: PathData; size; fill?; stroke? }

Transform { x; y; rotation; scaleX; scaleY; anchor }
Paint     = Solid{color} | LinearGradient{angle, stops} | RadialGradient{...} | ImagePaint{asset, fit}
Effect    = Shadow{x,y,blur,spread,color} | Blur{radius} | BackgroundBlur{radius}
MaskRef   { nodeId: string; mode: 'alpha'|'luminance' }     // a mask references a sibling node
BlendMode = 'normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'soft-light'|'hard-light'|'difference'|'exclusion'|'hue'|'saturation'|'color'|'luminosity'
FontRef   { family; source: 'bundled'|'file'; path? }
AssetRef  { id; source: 'file'|'url'|'inline'; path?; hash }
```

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

- `id` unique per Document.
- `mask.nodeId` points to an existing node that is not a descendant of the masked node.
- Referenced fonts exist in `Document.fonts`; assets in `Document.assets`.
- No Text with empty `runs`.
