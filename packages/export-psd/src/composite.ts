/**
 * Decoded pixels: straight (not premultiplied) RGBA, 8 bits a channel, row by row from the
 * top left, `width × height × 4` bytes. What a PNG decoder such as `pngjs` hands back.
 */
export interface RgbaPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** One layer as the composite sees it. */
export interface CompositeLayer {
  readonly pixels: RgbaPixels;
  /** 0 to 1, the layer's own opacity, multiplied into every pixel's alpha. */
  readonly opacity: number;
}

const CHANNELS = 4;
const OPAQUE = 255;

/**
 * The flattened picture a PSD carries beside its layers: `layers` bottom first, each drawn
 * "over" what is below it, on a transparent canvas.
 *
 * `ag-psd` writes whatever composite it is given and has no way to compute one without a
 * canvas, which a pure package does not have (ADR 0010); a PSD without one opens in
 * Photoshop, which recomposes the layers, but every viewer that shows the flattened image
 * (a file browser's preview, a web viewer) would show black. So it is computed here, in
 * plain arithmetic: the "normal" blend, which is the only one a guide layer uses.
 */
export function compositeOver(
  width: number,
  height: number,
  layers: readonly CompositeLayer[],
): RgbaPixels {
  const data = new Uint8Array(width * height * CHANNELS);
  for (const layer of layers) {
    const source = layer.pixels.data;
    for (let index = 0; index < data.length; index += CHANNELS) {
      const sourceAlpha = ((source[index + 3] ?? 0) / OPAQUE) * layer.opacity;
      if (sourceAlpha === 0) continue;
      const belowAlpha = (data[index + 3] ?? 0) / OPAQUE;
      const alpha = sourceAlpha + belowAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        const above = (source[index + channel] ?? 0) * sourceAlpha;
        const below = (data[index + channel] ?? 0) * belowAlpha * (1 - sourceAlpha);
        data[index + channel] = Math.round((above + below) / alpha);
      }
      data[index + 3] = Math.round(alpha * OPAQUE);
    }
  }
  return { width, height, data };
}
