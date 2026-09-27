import { ok } from '@tyto/core';
import { type Exporter, createPluginHost } from '@tyto/plugin-api';
import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';

import {
  needsRasterizer,
  outputRequests,
  parseFormatList,
  parseQuality,
  parseTypes,
  unavailableTypes,
} from './options.js';

function exporter(id: string, kinds: readonly string[], rasterized: boolean): Exporter {
  return { id, mime: `x/${id}`, extension: id, kinds, rasterized, exportFrame: () => ok('') };
}

/** Tyto's two, shaped as they register, and an installed `pdf` beside them. */
function registry() {
  const host = createPluginHost();
  host.hostFor('html').registerExporter(exporter('html', ['png', 'jpeg', 'webp'], true));
  host.hostFor('svg').registerExporter(exporter('svg', ['svg'], false));
  host.hostFor('pdf').registerExporter(exporter('pdf', ['pdf'], false));
  return host.registry.exporters;
}

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

  it('accepts a kind it has never heard of, because an installed exporter may produce it', () => {
    // Which kinds exist is the registry's answer, known only once plugins are activated.
    expect(parseTypes('pdf')).toEqual(['pdf']);
  });

  it('still refuses a word no exporter could declare', () => {
    expect(() => parseTypes('PDF')).toThrow(InvalidArgumentError);
    expect(() => parseTypes('p/f')).toThrow(/lowercase letters, digits and hyphens/u);
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
    expect(needsRasterizer(['svg'], registry())).toBe(false);
    expect(needsRasterizer(['svg', 'png'], registry())).toBe(true);
  });

  it('asks the exporter rather than the kind, so an installed pdf launches nothing', () => {
    expect(needsRasterizer(['pdf'], registry())).toBe(false);
  });
});

describe('a type nothing produces', () => {
  it('is refused after the registry is known, naming every kind that is available', () => {
    expect(unavailableTypes(['png', 'gif'], registry())).toBe(
      "'gif' is not an output type any installed exporter produces. Available: png, jpeg, webp, svg, pdf.",
    );
  });

  it('is nothing to say when every kind has an exporter', () => {
    expect(unavailableTypes(['pdf', 'svg'], registry())).toBeUndefined();
  });
});
