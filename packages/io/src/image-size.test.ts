import { describe, expect, it } from 'vitest';

import { imageSize } from './image-size.js';

/**
 * The pictures below are real files, and that is the whole point of this suite.
 *
 * A header parser tested against a header the same hand wrote proves only that the two
 * agree. So every fixture here except the AVIF was produced by Chrome — a 37×23 canvas
 * through `toDataURL`, with the WebP variants pulled back out of it — and every one was
 * then handed to Chrome as a `data:` URI and decoded before being pasted in: `naturalWidth`
 * and `naturalHeight` said 37 and 23 for all six. The numbers are deliberate too. Both are
 * prime and neither is a multiple of the other, so a width read as a height, a byte order
 * swapped, or a field off by one cannot come out looking right.
 *
 * The AVIF is the exception and is declared as one. Chrome encodes no AVIF from a canvas
 * and this repository has no encoder, so that one is assembled here out of the boxes the
 * format specifies. It exercises the walk, not the format.
 */

/** A 37×23 PNG. The size sits in the IHDR chunk, right behind the signature. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACUAAAAXCAYAAACMLIalAAAAXUlEQVR4AezSMQ3AQAwEQevxhUBghUtAhJWjY7' +
  'CFi39pLV13hTX2qu/tifRdPZVVG45L0aMopRQVoD1/6mypfq6aCFUgPX+KKKWjVBRIlCJK6SgVBRKliFI6W0r9' +
  'AAAA//8h/b/xAAAABklEQVQDAOm+esJyb4QmAAAAAElFTkSuQmCC';

/**
 * The same picture as JPEG, colour profile and all.
 *
 * The ICC profile is worth keeping rather than stripping: it is a 700-byte segment between
 * the start of the file and the frame header, which is exactly the run of metadata the
 * size has to be walked past.
 */
const JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4A' +
  'ABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAAB' +
  'RnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJD' +
  'AAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAA' +
  'AAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYA' +
  'AQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW' +
  '5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABsSFBcUERsXFhceHBsgKEIr' +
  'KCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl' +
  '1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAAXACUDASIA' +
  'AhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAIB/8QAGBABAQEBAQAAAAAAAAAAAAAAAAESITH/xAAZAQEAAg' +
  'MAAAAAAAAAAAAAAAAAAgMEBQb/xAAdEQACAgEFAAAAAAAAAAAAAAAAAQIDERQVMWGR/9oADAMBAAIRAxEAPwCx' +
  'OqaqOqrMTbL+vRfWF6NfN5k2joKYuFcYvlJABAtAAAAAAAP/2Q==';

/** WebP with an extended header, which is what a profile or an alpha channel puts in front. */
const WEBP_VP8X =
  'UklGRlACAABXRUJQVlA4WAoAAAAgAAAAJAAAFgAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4A' +
  'ABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAAB' +
  'RnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJD' +
  'AAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAA' +
  'AAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYA' +
  'AQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW' +
  '5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggYgAAANADAJ0BKiUAFwA/EYC3' +
  'U6wopaKqqAGAIglAGUXnxIK0AA8p67B4AADgPxc8Cd9naomr/+Fa8oBsrgHDXK4Buwdw66eurVBcz0XGxxwPv/' +
  '8m/p9/Yr/L9Y93/Xx08tomgAAA';

/** The lossy frame alone: a 14-bit width and height behind a three-byte start code. */
const WEBP_VP8 =
  'UklGRm4AAABXRUJQVlA4IGIAAADQAwCdASolABcAPxGAt1OsKKWiqqgBgCIJQBlF58SCtAAPKeuweAAA4D8XPA' +
  'nfZ2qJq//hWvKAbK4Bw1yuAbsHcOunrq1QXM9FxsccD7//Jv6ff2K/y/WPd/18dPLaJoAAAA==';

/** The lossless frame alone: 28 bits holding both numbers, each one less than it really is. */
const WEBP_VP8L = 'UklGRjAAAABXRUJQVlA4TCQAAAAvJIAFAA/wSOT5PxPt/EcLFLKNAM3k/B0/gBOI6H+Ap8e2nwA=';

/** The smallest legal GIF89a there is, which Chrome still decodes as 37×23. */
const GIF = 'R0lGODlhJQAXAIAAAP9ZAADItCwAAAAAJQAXAAACAkQBADs=';

/** One ISOBMFF box: a big-endian length, a four-letter type, and the body. */
function box(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function ispe(w: number, h: number): Buffer {
  const body = Buffer.alloc(12);
  body.writeUInt32BE(w, 4);
  body.writeUInt32BE(h, 8);
  return box('ispe', body);
}

/**
 * An AVIF as far as `imageSize` reads one: `ftyp`, then the `ispe` four boxes deep.
 *
 * A file with a thumbnail declares more than one, and nothing at this depth marks either
 * as the picture, so the largest wins. This builder is what lets that be stated.
 */
function avif(...sizes: readonly (readonly [number, number])[]): Buffer {
  const properties = box('ipco', Buffer.concat(sizes.map(([w, h]) => ispe(w, h))));
  // `meta` is a full box: four bytes of version and flags before its children.
  const meta = box('meta', Buffer.concat([Buffer.alloc(4), box('iprp', properties)]));
  return Buffer.concat([box('ftyp', Buffer.from('avifavifmif1', 'latin1')), meta]);
}

const bytes = (base64: string): Buffer => Buffer.from(base64, 'base64');

describe('a picture states its own size, and the header is where', () => {
  it.each([
    ['PNG', PNG],
    ['JPEG behind an ICC profile', JPEG],
    ['WebP with an extended header', WEBP_VP8X],
    ['WebP, lossy frame only', WEBP_VP8],
    ['WebP, lossless frame only', WEBP_VP8L],
    ['GIF89a', GIF],
  ])('reads 37 by 23 out of a real %s', (_name, base64) => {
    expect(imageSize(bytes(base64))).toEqual({ w: 37, h: 23 });
  });

  it('reads an AVIF, whose size is four boxes deep', () => {
    expect(imageSize(avif([37, 23]))).toEqual({ w: 37, h: 23 });
  });

  it('takes the largest of several AVIF sizes, since a thumbnail declares one too', () => {
    expect(imageSize(avif([8, 5], [37, 23], [4, 3]))).toEqual({ w: 37, h: 23 });
  });

  it('reads an SVG from the box it declares, width and height first', () => {
    const svg =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ' +
      'width=\'37px\' height=\'23\' viewBox="0 0 100 100"><circle r="1"/></svg>';

    // `viewBox` is a coordinate system, not a size. It answers only when nothing else did.
    expect(imageSize(Buffer.from(svg, 'utf8'))).toEqual({ w: 37, h: 23 });
  });

  it('falls back to an SVG viewBox when the file states no width', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 23"><path d="M0 0"/></svg>';

    expect(imageSize(Buffer.from(svg, 'utf8'))).toEqual({ w: 37, h: 23 });
  });

  it('answers nothing for a header it cannot read, rather than guessing', () => {
    // `undefined` reaches `export-svg` as "not measured", and that export falls back to
    // `preserveAspectRatio`. A guess would place the picture confidently and wrongly.
    expect(imageSize(Buffer.from('not an image at all', 'utf8'))).toBeUndefined();
    expect(imageSize(Buffer.alloc(0))).toBeUndefined();
    // Truncated: the signature is there and the field it points at is not.
    expect(imageSize(bytes(PNG).subarray(0, 16))).toBeUndefined();
  });

  it('answers nothing for an SVG with neither a size nor a viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';

    expect(imageSize(Buffer.from(svg, 'utf8'))).toBeUndefined();
  });
});
