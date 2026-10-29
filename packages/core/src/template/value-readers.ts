import type { AssetRef } from '../scene/primitives.js';
import type { TemplateContext } from './define.js';
import type { ManifestFace } from './manifest.js';

/**
 * What a template reads its declared values through (ADR 0153), apart from
 * `declared-values.ts`, which resolves them: this file is part of `@tyto/core/template`, which a
 * plugin bundles, so it imports nothing at run time. The resolver reads the manifest's schema,
 * and with it `yaml`, which a bundled plugin cannot load.
 */

/** A resolved value: a hex colour, px or a plain number, a face, or an image's ref. */
export type TemplateValue = string | number | ManifestFace | AssetRef;

/** Every declared value by name; an image with no default and nothing supplied is absent. */
export type TemplateValues = Readonly<Record<string, TemplateValue>>;

/**
 * What a template reads its declared values through. Each takes the code's own constant as
 * the fallback, for a context with no `values` — one built by hand in a test, or a call from a
 * host older than protocol 10, which sent none — and for a value of another kind than asked. A test pins the manifest's default to that constant, so both
 * paths draw the same.
 */
export function numberValue(
  context: Pick<TemplateContext, 'values'>,
  name: string,
  fallback: number,
): number {
  const value = context.values?.[name];
  return typeof value === 'number' ? value : fallback;
}

export function colorValue(
  context: Pick<TemplateContext, 'values'>,
  name: string,
  fallback: string,
): string {
  const value = context.values?.[name];
  return typeof value === 'string' ? value : fallback;
}

export function faceValue(
  context: Pick<TemplateContext, 'values'>,
  name: string,
  fallback: ManifestFace,
): ManifestFace {
  const value = context.values?.[name];
  return typeof value === 'object' && 'family' in value ? value : fallback;
}

export function imageValue(
  context: Pick<TemplateContext, 'values'>,
  name: string,
): AssetRef | undefined {
  const value = context.values?.[name];
  return typeof value === 'object' && 'hash' in value ? value : undefined;
}
