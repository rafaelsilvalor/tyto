/**
 * The first 24 bytes of a PNG `w` by `h`: the signature and an IHDR naming the size.
 *
 * Enough for `imageSize`, which reads the header and decodes nothing, so a test can say
 * which size it expects without carrying a real picture's base64 (ADR 0158).
 */
export function pngHeader(w: number, h: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89_50_4e_47, 0);
  bytes.writeUInt32BE(0x0d_0a_1a_0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(w, 16);
  bytes.writeUInt32BE(h, 20);
  return bytes;
}
