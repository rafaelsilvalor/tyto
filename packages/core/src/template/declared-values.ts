import { diagnostic } from '../diagnostics/diagnostic.js';
import { assetRefSchema } from '../scene/primitives.js';
import { HEX_COLOR, manifestFaceSchema } from './manifest.js';

import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { SourceRange } from '../source/range.js';
import type { TemplateFiles } from './define.js';
import type { DeclaredValue, TemplateManifest } from './manifest.js';
import type { TemplateValue, TemplateValues } from './value-readers.js';

/**
 * The values a template declared configurable, resolved for one compile (ADR 0153).
 *
 * The manifest's `values` say what may change and what it is when nothing changes it. A
 * caller supplies some of them — a test today, a plugin file's configuration once TYTO-439
 * reads one — and this overlays the supplied over the defaults, value by value. A supplied
 * value the template did not declare, of the wrong kind or outside its limits costs that value
 * alone: it is a warning at the range it was written at, and the default stands (ADR 0151
 * decision 2, "a refused entry costs that entry alone").
 */

/** One value as a caller supplies it, with where it was written when it was written somewhere. */
export interface SuppliedValue {
  readonly value: unknown;
  readonly range?: SourceRange;
}

export type SuppliedValues = Readonly<Record<string, SuppliedValue>>;

export interface ResolvedValues {
  readonly values: TemplateValues;
  readonly diagnostics: readonly Diagnostic[];
}

/** `20` and `'20px'` are the same length: a plugin file is written by people (ADR 0151). */
const PX = /^(-?\d+(?:\.\d+)?)px$/u;

export function resolveValues(
  manifest: TemplateManifest,
  supplied: SuppliedValues | undefined,
  files: TemplateFiles,
): ResolvedValues {
  const declared = manifest.values ?? {};
  const values: Record<string, TemplateValue> = {};
  const diagnostics: Diagnostic[] = [];

  for (const [name, declaration] of Object.entries(declared)) {
    const fallback = defaultOf(declaration, files);
    if (fallback !== undefined) values[name] = fallback;
  }

  for (const [name, { value, range }] of Object.entries(supplied ?? {})) {
    const where = range === undefined ? {} : { range };
    const declaration = declared[name];
    if (declaration === undefined) {
      diagnostics.push(
        diagnostic('W_TEMPLATE_VALUE_UNKNOWN', { template: manifest.name, name }, where),
      );
      continue;
    }
    const checked = check(declaration, value);
    if ('problem' in checked) {
      diagnostics.push(
        diagnostic(
          'W_TEMPLATE_VALUE_INVALID',
          { template: manifest.name, name, problem: checked.problem },
          where,
        ),
      );
      continue;
    }
    values[name] = checked.value;
  }

  return { values, diagnostics };
}

function defaultOf(declaration: DeclaredValue, files: TemplateFiles): TemplateValue | undefined {
  if (declaration.type !== 'image') return declaration.default;
  return declaration.default === undefined ? undefined : files.image(declaration.default);
}

type Checked = { readonly value: TemplateValue } | { readonly problem: string };

function check(declaration: DeclaredValue, value: unknown): Checked {
  switch (declaration.type) {
    case 'color':
      return typeof value === 'string' && HEX_COLOR.test(value)
        ? { value }
        : { problem: "is not a hex colour such as '#5900a7'" };
    case 'length': {
      const px = typeof value === 'string' ? PX.exec(value)?.[1] : undefined;
      const length = typeof value === 'number' ? value : px === undefined ? undefined : Number(px);
      if (length === undefined) return { problem: "is not a length such as 20 or '20px'" };
      return within(length, declaration, 'px');
    }
    case 'number':
      return typeof value === 'number'
        ? within(value, declaration, '')
        : { problem: 'is not a number' };
    case 'face': {
      const face = manifestFaceSchema.safeParse(value);
      return face.success
        ? { value: face.data }
        : { problem: 'is not a face such as { family: Inter, weight: 700 }' };
    }
    case 'image': {
      const asset = assetRefSchema.safeParse(value);
      return asset.success
        ? { value: asset.data }
        : { problem: 'is not an image the host resolved' };
    }
  }
}

function within(
  value: number,
  limits: { readonly min?: number | undefined; readonly max?: number | undefined },
  unit: string,
): Checked {
  if (!Number.isFinite(value)) return { problem: 'is not a finite number' };
  if (limits.min !== undefined && value < limits.min) {
    return { problem: `is ${value}${unit}, below its minimum of ${limits.min}${unit}` };
  }
  if (limits.max !== undefined && value > limits.max) {
    return { problem: `is ${value}${unit}, above its maximum of ${limits.max}${unit}` };
  }
  return { value };
}
