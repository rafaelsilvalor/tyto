import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';

import {
  needsRasterizer,
  outputRequests,
  parseFormatList,
  parseQuality,
  parseTypes,
} from './options.js';

describe('--types', () => {
  it('takes a comma-separated list in the order it was written', () => {
    expect(parseTypes('svg,png')).toEqual(['svg', 'png']);
  });

  it('drops the blank a trailing comma leaves', () => {
    expect(parseTypes('png, svg,')).toEqual(['png', 'svg']);
  });

  it('deduplicates, because writing the same file twice is not an output', () => {
    expect(parseTypes('png,png')).toEqual(['png']);
  });

  it('refuses a type nothing can produce, and names the ones it can', () => {
    expect(() => parseTypes('pdf')).toThrow(InvalidArgumentError);
    expect(() => parseTypes('pdf')).toThrow(/png, jpeg, webp, svg/u);
  });

  it('refuses an empty list rather than rendering nothing successfully', () => {
    expect(() => parseTypes(' , ')).toThrow(InvalidArgumentError);
  });
});

describe('--quality', () => {
  it('takes 1 to 100 and nothing outside it', () => {
    expect(parseQuality('80')).toBe(80);
    expect(() => parseQuality('0')).toThrow(InvalidArgumentError);
    expect(() => parseQuality('101')).toThrow(InvalidArgumentError);
    expect(() => parseQuality('80.5')).toThrow(InvalidArgumentError);
  });
});

describe('--formats', () => {
  it('refuses an empty list', () => {
    expect(() => parseFormatList('  ')).toThrow(InvalidArgumentError);
  });
});

describe('the requests a run is planned from', () => {
  it('never sends quality with png, which the rasterizer port refuses', () => {
    const requests = outputRequests({ types: ['png', 'webp'], quality: 70 });

    expect(requests).toEqual([{ kind: 'png' }, { kind: 'webp', quality: 70 }]);
  });

  it('puts scale on the raster outputs and not on svg', () => {
    const requests = outputRequests({ types: ['svg', 'png'], scale: 2 });

    expect(requests).toEqual([{ kind: 'svg' }, { kind: 'png', scale: 2 }]);
  });
});

describe('whether a browser is needed at all', () => {
  it('is false for svg alone, so --types svg never launches one', () => {
    expect(needsRasterizer(['svg'])).toBe(false);
    expect(needsRasterizer(['svg', 'png'])).toBe(true);
  });
});
