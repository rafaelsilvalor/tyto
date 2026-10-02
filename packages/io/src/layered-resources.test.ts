import type { AssetRef, Size } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import type { ExportResources } from './export-resources.js';
import { layeredExportResources } from './layered-resources.js';

const LOGO: AssetRef = { id: 'logo', source: 'file', path: './logo.png', hash: 'sha256-1f' };
const OTHER: AssetRef = { id: 'other', source: 'file', path: './other.png', hash: 'sha256-2a' };

/** A layer that knows one ref, and answers it with its own name and size. */
function layer(name: string, knows: AssetRef, size: Size): ExportResources {
  const asset = (ref: AssetRef): string | undefined => (ref === knows ? name : undefined);
  const assetSize = (ref: AssetRef): Size | undefined => (ref === knows ? size : undefined);
  return { html: { asset }, svg: { asset, assetSize } };
}

describe('layeredExportResources', () => {
  it('answers from the first layer that knows the ref, in both halves', () => {
    const resources = layeredExportResources([
      layer('brief', LOGO, { w: 3, h: 2 }),
      layer('template', LOGO, { w: 7, h: 5 }),
    ]);

    expect(resources.html?.asset?.(LOGO)).toBe('brief');
    expect(resources.svg?.asset?.(LOGO)).toBe('brief');
    expect(resources.svg?.assetSize?.(LOGO)).toEqual({ w: 3, h: 2 });
  });

  it('falls through to a later layer, past one that is absent', () => {
    const resources = layeredExportResources([
      undefined,
      layer('brief', LOGO, { w: 3, h: 2 }),
      layer('template', OTHER, { w: 7, h: 5 }),
    ]);

    expect(resources.html?.asset?.(OTHER)).toBe('template');
    // The size is what lets the SVG exporter write a `cover` crop itself (TYTO-60, TYTO-215).
    expect(resources.svg?.assetSize?.(OTHER)).toEqual({ w: 7, h: 5 });
  });

  it('answers nothing for a ref no layer knows', () => {
    const resources = layeredExportResources([layer('brief', LOGO, { w: 3, h: 2 })]);

    expect(resources.html?.asset?.(OTHER)).toBeUndefined();
    expect(resources.svg?.assetSize?.(OTHER)).toBeUndefined();
  });

  it('reads the list when asked, so a layer pushed after the call is seen', () => {
    // A template's bytes are only known once the job has loaded it (render-context.ts).
    const loaded: ExportResources[] = [];
    const resources = layeredExportResources(loaded);
    expect(resources.svg?.asset?.(LOGO)).toBeUndefined();

    loaded.push(layer('template', LOGO, { w: 7, h: 5 }));

    expect(resources.svg?.asset?.(LOGO)).toBe('template');
    expect(resources.svg?.assetSize?.(LOGO)).toEqual({ w: 7, h: 5 });
  });
});
