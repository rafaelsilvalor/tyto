import { describe, expect, it } from 'vitest';

import { formatCatalogue } from '../config/formats.js';
import {
  aspectOf,
  aspectsText,
  catalogueSizes,
  checkDelivery,
  deliveryExportNames,
} from './delivery-check.js';

/**
 * `aspectOf` pins the edge cases of the shapes a plugin counts on a remote folder (TYTO-761's
 * `drive-count shapes=yes`), case for case, so a recipe that maps both through one vocabulary
 * table never meets a word only one side writes.
 */
describe('aspectOf', () => {
  it.each([
    // The usual ratios, exactly.
    [1080, 1080, '1:1'],
    [1080, 1350, '4:5'],
    [1080, 1920, '9:16'],
    [1920, 1080, '16:9'],
    [1500, 1000, '3:2'],
    [1000, 1500, '2:3'],
    // 4:5 is 0.8: 0.816 and 0.784 are its 2% edges.
    [1101, 1350, '4:5'],
    [1110, 1350, '37:45'],
    [1059, 1350, '4:5'],
    [1050, 1350, '7:9'],
    // 1:1, on the same two sides.
    [1019, 1000, '1:1'],
    [1030, 1000, '103:100'],
    [981, 1000, '1:1'],
    [970, 1000, '97:100'],
    // Past 2:1 is wide; 2:1 itself is its ratio.
    [2001, 1000, 'wide'],
    [4000, 1000, 'wide'],
    [2000, 1000, '2:1'],
    // A missing dimension.
    [undefined, undefined, '?'],
    [1080, undefined, '?'],
    [undefined, 1350, '?'],
  ])('reads %s×%s as %s', (width, height, expected) => {
    expect(aspectOf(width, height)).toBe(expected);
  });
});

describe('catalogueSizes', () => {
  it('gives each format of a catalogue by id at its size', () => {
    const catalogue = formatCatalogue({
      story: { w: 1080, h: 1920 },
      'grid-1x1': { w: 1080, h: 1080, label: 'Square' },
    });
    expect(catalogueSizes(catalogue)).toEqual({
      story: { w: 1080, h: 1920 },
      'grid-1x1': { w: 1080, h: 1080 },
    });
  });
});

describe('aspectsText', () => {
  it('sorts by count, most first, then by ratio', () => {
    const aspects = new Map([
      ['9:16', 1],
      ['?', 2],
      ['4:5', 3],
      ['1:1', 1],
    ]);
    expect(aspectsText(aspects)).toBe('4:5:3,?:2,1:1:1,9:16:1');
    expect(aspectsText(new Map())).toBe('');
  });
});

const sizes = { feed: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } };
const owed = [
  { format: 'feed', count: 1 },
  { format: 'story', count: 1 },
];

describe('checkDelivery', () => {
  it('is ready when every format owed landed at its size and an editable is kept', () => {
    const check = checkDelivery({
      formats: owed,
      sizes,
      images: [
        { name: 'b.png', size: { w: 1080, h: 1920 } },
        { name: 'a.png', size: { w: 1080, h: 1350 } },
      ],
      editables: 1,
    });
    expect(check).toEqual({ state: 'ready', problems: [], found: '4:5:1,9:16:1' });
  });

  it('names a wrong-size file with the sizes the record owes', () => {
    const check = checkDelivery({
      formats: owed,
      sizes,
      images: [
        { name: 'feed.png', size: { w: 1080, h: 1080 } },
        { name: 'story.png', size: { w: 1080, h: 1920 } },
      ],
      editables: 1,
    });
    expect(check.state).toBe('incomplete');
    expect(check.problems).toEqual([
      "'feed' has 0 of 1 at 1080×1350",
      "'feed.png' is 1080×1080, and the record owes feed 1080×1350, story 1080×1920",
    ]);
    expect(check.found).toBe('1:1:1,9:16:1');
  });

  it('counts a format short and an image too many', () => {
    const check = checkDelivery({
      formats: [{ format: 'feed', count: 3 }],
      sizes,
      images: [{ name: 'a.png', size: { w: 1080, h: 1350 } }],
      editables: 1,
    });
    expect(check.problems).toEqual(["'feed' has 1 of 3 at 1080×1350"]);
    const extra = checkDelivery({
      formats: [{ format: 'feed', count: 1 }],
      sizes,
      images: [
        { name: 'a.png', size: { w: 1080, h: 1350 } },
        { name: 'b.png', size: { w: 1080, h: 1350 } },
      ],
      editables: 1,
    });
    expect(extra.problems).toEqual(["'b.png' is one 1080×1350 more than the record owes"]);
  });

  it('shares images between two formats of one size before counting an extra', () => {
    const check = checkDelivery({
      formats: [
        { format: 'feed', count: 1 },
        { format: 'cover', count: 1 },
      ],
      sizes: { feed: { w: 1080, h: 1350 }, cover: { w: 1080, h: 1350 } },
      images: [
        { name: 'a.png', size: { w: 1080, h: 1350 } },
        { name: 'b.png', size: { w: 1080, h: 1350 } },
      ],
      editables: 1,
    });
    expect(check.state).toBe('ready');
  });

  it('asks for an editable, and names an image whose size did not read', () => {
    const check = checkDelivery({
      formats: [{ format: 'feed', count: 1 }],
      sizes,
      images: [{ name: 'a.png', size: { w: 1080, h: 1350 } }, { name: 'broken.png' }],
      editables: 0,
    });
    expect(check.problems).toEqual([
      "'broken.png' is an image whose size cannot be read",
      'no editable is kept beside the record',
    ]);
    expect(check.found).toBe('4:5:1,?:1');
  });

  it('stays in progress while nothing landed, naming a format with no size', () => {
    const check = checkDelivery({
      formats: [{ format: 'reel', count: 1 }, ...owed],
      sizes,
      images: [],
      editables: 1,
    });
    expect(check).toEqual({
      state: 'in-progress',
      problems: ["no size is known for 'reel'; add it to delivery.sizes"],
      found: '',
    });
  });

  it('is incomplete when a format has no size, though every sized one landed', () => {
    const check = checkDelivery({
      formats: [{ format: 'reel', count: 1 }],
      sizes,
      images: [{ name: 'a.png', size: { w: 1080, h: 1920 } }],
      editables: 1,
    });
    expect(check.state).toBe('incomplete');
    expect(check.problems).toEqual([
      "no size is known for 'reel'; add it to delivery.sizes",
      "'a.png' is 1080×1920, and the record owes no size Tyto knows",
    ]);
  });

  it('stays in progress for a record that owes no formats, and still tells the shapes', () => {
    const check = checkDelivery({
      sizes,
      images: [{ name: 'a.png', size: { w: 1080, h: 1350 } }],
      editables: 0,
    });
    expect(check).toEqual({
      state: 'in-progress',
      problems: ['the record owes no formats to check'],
      found: '4:5:1',
    });
  });

  it('never reads a size from the object prototype', () => {
    const check = checkDelivery({
      formats: [{ format: 'constructor', count: 1 }],
      sizes,
      images: [],
      editables: 1,
    });
    expect(check.problems).toEqual([
      "no size is known for 'constructor'; add it to delivery.sizes",
    ]);
  });
});

describe('deliveryExportNames', () => {
  const owedSizes = { feed: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } };

  it('numbers the owed images in the record order of formats, then the rest by name', () => {
    const named = deliveryExportNames({
      formats: [
        { format: 'story', count: 1 },
        { format: 'feed', count: 2 },
      ],
      sizes: owedSizes,
      images: [
        { name: 'zz-extra.JPEG', size: { w: 500, h: 500 } },
        { name: 'b.png', size: owedSizes.feed },
        { name: 'a.png', size: owedSizes.feed },
        { name: 'cover.png', size: owedSizes.story },
        { name: 'broken.png' },
      ],
      stem: 'mca-1_aula',
      digits: 2,
    });

    expect(named).toEqual({
      names: [
        { from: 'cover.png', to: 'mca-1_aula-01.png' },
        { from: 'a.png', to: 'mca-1_aula-02.png' },
        { from: 'b.png', to: 'mca-1_aula-03.png' },
        { from: 'broken.png', to: 'mca-1_aula-04.png' },
        { from: 'zz-extra.JPEG', to: 'mca-1_aula-05.jpeg' },
      ],
    });
  });

  it('refuses an empty stem, one a file name cannot hold, and more images than the digits number', () => {
    const images = [{ name: 'a.png' }, { name: 'b.png' }];
    expect(deliveryExportNames({ sizes: owedSizes, images, stem: ' ', digits: 2 })).toEqual({
      problem: "its stem ' ' ends in a space or a dot, which Windows drops from a name",
    });
    expect(deliveryExportNames({ sizes: owedSizes, images, stem: '', digits: 2 })).toEqual({
      problem: 'its stem is empty',
    });
    expect(deliveryExportNames({ sizes: owedSizes, images, stem: 'a/b', digits: 2 })).toEqual({
      problem: "its stem 'a/b' holds a path separator, which a file-name stem may not",
    });
    expect(
      deliveryExportNames({
        sizes: owedSizes,
        images: Array.from({ length: 10 }, (_, index) => ({ name: `${String(index)}.png` })),
        stem: 'x',
        digits: 1,
      }),
    ).toEqual({ problem: 'has 10 exports, more than digits=1 numbers' });
  });
});
