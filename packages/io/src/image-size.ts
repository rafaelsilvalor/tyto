import type { Size } from '@tyto/core';

/**
 * How wide and how tall a picture is, read from its header.
 *
 * `export-svg` needs the number to crop a `cover` image itself instead of asking the
 * renderer to (TYTO-60, `SvgResources.assetSize`), and the exporters are pure: they open
 * no files and decode no bytes. This package is the side that already has both — `readOne`
 * holds the whole file in a Buffer on its way to a `data:` URI — so the measurement is a
 * few bytes off a header that is already in memory, not a second read and not a decode.
 *
 * Every format Tyto embeds is answered here (`EMBEDDABLE_MIME`). A file whose header does
 * not parse returns `undefined`, and the exporter falls back to `preserveAspectRatio`,
 * which is what it emitted before the port existed. A wrong guess would be worse than no
 * answer: it would place the picture with confidence, in the wrong place.
 */

function png(bytes: Buffer): Size | undefined {
  // The signature, then an IHDR whose width and height are the first two fields.
  if (bytes.length < 24) return undefined;
  if (bytes.readUInt32BE(0) !== 0x89_50_4e_47) return undefined;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

function gif(bytes: Buffer): Size | undefined {
  if (bytes.length < 10) return undefined;
  const header = bytes.toString('latin1', 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return undefined;
  return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) };
}

/** The frame-header markers, which carry the size; `C4`, `C8` and `CC` are not frames. */
const JPEG_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpeg(bytes: Buffer): Size | undefined {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xff_d8) return undefined;

  // JPEG states its size in a frame header somewhere after an arbitrary run of metadata,
  // so the segments are walked rather than indexed. Padding between them is a run of
  // `0xff`, which is why the marker is looked for instead of assumed.
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) return undefined;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (JPEG_FRAME.has(marker)) {
      return { w: bytes.readUInt16BE(offset + 7), h: bytes.readUInt16BE(offset + 5) };
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

/**
 * WebP has three, and they state the size three different ways.
 *
 * `VP8 ` is a lossy frame, `VP8L` a lossless one, and `VP8X` the extended header an
 * animation or an alpha channel puts in front of either.
 */
function webp(bytes: Buffer): Size | undefined {
  if (bytes.length < 30) return undefined;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF') return undefined;
  if (bytes.toString('latin1', 8, 12) !== 'WEBP') return undefined;

  const chunk = bytes.toString('latin1', 12, 16);

  if (chunk === 'VP8X') {
    return { w: bytes.readUIntLE(24, 3) + 1, h: bytes.readUIntLE(27, 3) + 1 };
  }
  if (chunk === 'VP8L') {
    // A 14-bit width and a 14-bit height, one less than the real one, packed into 28 bits
    // after the `0x2f` signature byte.
    const packed = bytes.readUInt32LE(21);
    return { w: (packed & 0x3fff) + 1, h: ((packed >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    if (bytes.toString('latin1', 23, 26) !== '*') return undefined;
    return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff };
  }
  return undefined;
}

interface Box {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

/** The boxes directly inside `[start, end)`; ISOBMFF is a tree of length-tagged records. */
function boxesIn(bytes: Buffer, start: number, end: number): Box[] {
  const found: Box[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    const declared = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    let head = 8;
    let size = declared;

    if (declared === 1) {
      if (offset + 16 > end) return found;
      // A 64-bit length, of which only the low half can address a file this side of 4 GB.
      size = Number(bytes.readBigUInt64BE(offset + 8));
      head = 16;
    } else if (declared === 0) {
      size = end - offset;
    }

    if (size < head || offset + size > end) return found;
    found.push({ type, start: offset + head, end: offset + size });
    offset += size;
  }

  return found;
}

/**
 * AVIF keeps the size in an `ispe` box, several boxes deep, and may keep more than one.
 *
 * A file with a thumbnail states a size for that too, and nothing at this depth says which
 * item is the picture — that needs the `pitm` and `ipma` tables, which is a lot of walking
 * for a tie-break. The largest is taken instead: a thumbnail is smaller than the picture
 * it is a thumbnail of, which settles every real file.
 */
function avif(bytes: Buffer): Size | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes.toString('latin1', 4, 8) !== 'ftyp') return undefined;

  const meta = boxesIn(bytes, 0, bytes.length).find((box) => box.type === 'meta');
  if (meta === undefined) return undefined;

  // `meta` is a full box: four bytes of version and flags before its children.
  const properties = boxesIn(bytes, meta.start + 4, meta.end).find((box) => box.type === 'iprp');
  if (properties === undefined) return undefined;

  const container = boxesIn(bytes, properties.start, properties.end).find(
    (box) => box.type === 'ipco',
  );
  if (container === undefined) return undefined;

  let largest: Size | undefined;
  for (const box of boxesIn(bytes, container.start, container.end)) {
    if (box.type !== 'ispe' || box.end - box.start < 12) continue;
    const size: Size = {
      w: bytes.readUInt32BE(box.start + 4),
      h: bytes.readUInt32BE(box.start + 8),
    };
    if (largest === undefined || size.w * size.h > largest.w * largest.h) largest = size;
  }
  return largest;
}

const SVG_ROOT = /<svg((?:"[^"]*"|'[^']*'|[^>"'])*)>/iu;
const SVG_ATTRIBUTE = /([a-zA-Z_:][\w.:-]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][\w.:-]*)\s*=\s*'([^']*)'/gu;

function length(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value.trim().replace(/px$/iu, ''));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * An SVG has no pixels, so what is read is the box it declares.
 *
 * `width` and `height` first and `viewBox` second, which is the order a renderer resolves
 * an intrinsic size in: the viewBox is a coordinate system and only stands in for a size
 * when nothing else said one.
 */
function svg(bytes: Buffer): Size | undefined {
  // Only the head is decoded: an SVG with a base64 photo inside it is still a text file.
  const root = SVG_ROOT.exec(bytes.toString('utf8', 0, Math.min(bytes.length, 4096)));
  if (root === null) return undefined;

  const attributes = new Map<string, string>();
  for (const match of (root[1] ?? '').matchAll(SVG_ATTRIBUTE)) {
    const [, doubleName, doubleValue, singleName, singleValue] = match;
    const name = doubleName ?? singleName;
    const value = doubleValue ?? singleValue;
    if (name !== undefined && value !== undefined) attributes.set(name, value);
  }

  const w = length(attributes.get('width'));
  const h = length(attributes.get('height'));
  if (w !== undefined && h !== undefined) return { w, h };

  const viewBox = attributes
    .get('viewBox')
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (viewBox?.length !== 4) return undefined;
  const [, , boxWidth, boxHeight] = viewBox;
  if (boxWidth === undefined || boxHeight === undefined) return undefined;
  if (!(boxWidth > 0) || !(boxHeight > 0)) return undefined;
  return { w: boxWidth, h: boxHeight };
}

const READERS = [png, gif, jpeg, webp, avif, svg] as const;

/**
 * The picture's own width and height, or `undefined` for a header nothing here parses.
 *
 * Sniffed rather than dispatched on the extension: a `.jpg` that is really a PNG is a file
 * a browser renders and a lookup table would measure wrongly, and every reader below
 * already checks its own magic bytes before reading a field.
 */
export function imageSize(bytes: Buffer): Size | undefined {
  for (const read of READERS) {
    const size = read(bytes);
    if (size !== undefined && size.w > 0 && size.h > 0) return size;
  }
  return undefined;
}
