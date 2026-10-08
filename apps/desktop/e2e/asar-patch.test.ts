import { describe, expect, it } from 'vitest';

import { swapWhitespaceByte } from './asar-patch.js';

/** An archive in the layout electron-builder writes: two pickles, then the files' bytes. */
function archiveOf(header: object, content: string): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = Math.ceil(json.length / 4) * 4;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle, Buffer.from(content, 'utf8')]);
}

// `FIRST` ends in an indented blank line on purpose: an offset read a few bytes short lands
// there, inside the wrong file, and the exact-offset assertion below says so.
const FIRST = 'const a = 1;\n \n';
const MAIN = 'function f() {\n  return 1;\n}\n';
const FLAT = 'x;\n';

const archive = archiveOf(
  {
    files: {
      first: { files: { 'a.js': { offset: '0', size: FIRST.length } } },
      out: {
        files: {
          main: { files: { 'index.js': { offset: String(FIRST.length), size: MAIN.length } } },
        },
      },
      flat: {
        files: { 'b.js': { offset: String(FIRST.length + MAIN.length), size: FLAT.length } },
      },
      guest: { files: { 'g.js': { size: 3, unpacked: true } } },
    },
  },
  FIRST + MAIN + FLAT,
);
const mainStart = archive.length - FLAT.length - MAIN.length;

describe('swapWhitespaceByte', () => {
  it('changes exactly one byte, inside the named file, from a space to a tab', () => {
    const patch = swapWhitespaceByte(archive, 'out/main/index.js');

    const changed = [...archive.keys()].filter((index) => archive[index] !== patch.bytes[index]);
    expect(changed).toEqual([patch.archiveOffset]);
    expect(patch.archiveOffset).toBe(mainStart + MAIN.indexOf('\n ') + 1);
    expect(patch.bytes.length).toBe(archive.length);
    expect(patch.bytes.toString('utf8', mainStart, mainStart + MAIN.length)).toBe(
      'function f() {\n\t return 1;\n}\n',
    );
  });

  it('leaves the buffer it was given untouched', () => {
    const before = Buffer.from(archive);
    swapWhitespaceByte(archive, 'out/main/index.js');
    expect(archive.equals(before)).toBe(true);
  });

  it('refuses a file the archive does not hold, or holds unpacked', () => {
    expect(() => swapWhitespaceByte(archive, 'out/main/missing.js')).toThrow(/not a packed file/u);
    expect(() => swapWhitespaceByte(archive, 'guest/g.js')).toThrow(/unpacked/u);
  });

  it('refuses a file with no indented line rather than patching something that breaks it', () => {
    expect(() => swapWhitespaceByte(archive, 'flat/b.js')).toThrow(/no line that starts/u);
  });
});
