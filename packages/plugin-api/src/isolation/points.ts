import {
  type Diagnostics,
  artworkSchema,
  err,
  frameSchema,
  sceneSchema,
  templateManifestSchema,
} from '@tyto/core';
import { z } from 'zod';

import type { ContributionPoint } from '../manifest.js';
import { resultSchema } from './protocol.js';

/**
 * Which contributions an isolated plugin can make, and what crosses for each (ADR 0041).
 *
 * A contribution is data plus, sometimes, functions. The data crosses as it is and is
 * validated by the host against `data`; each function stays in the guest and crosses as a
 * handle the host calls back. **A function is callable only if it is named here**, with
 * the schema its arguments are checked against in the guest and the schema its answer is
 * checked against in the host — so adding a callable to a point is one entry, which is how
 * TYTO-49 gives a directive its transform.
 *
 * `failed` is what the caller receives when the call cannot be answered at all — the
 * process died, or answered something the schema refused — shaped like a real answer, so
 * the job reports a frame that failed rather than a promise that rejected.
 */

export interface CallableSpec {
  readonly args: z.ZodType<readonly unknown[]>;
  /** The arguments as sent, from the arguments as the caller passed them. */
  send(args: readonly unknown[]): readonly unknown[];
  readonly result: z.ZodType;
  failed(problems: Diagnostics): unknown;
}

export interface PointSpec {
  /** The `PluginHost` method a guest calls, and the host method the proxy calls. */
  readonly method: RegisterMethod;
  /** Every field that is not a function. */
  readonly data: z.ZodObject;
  readonly callables: Readonly<Record<string, CallableSpec>>;
}

export type RegisterMethod =
  | 'registerExporter'
  | 'registerSource'
  | 'registerSink'
  | 'registerRasterizer'
  | 'registerTemplatePack'
  | 'registerDirective'
  | 'registerCommand'
  | 'registerKeymap'
  | 'registerPanel';

const exportFrameOptionsSchema = z.strictObject({ textAsPaths: z.boolean().optional() });

export const ISOLATED_POINTS: Readonly<Partial<Record<ContributionPoint, PointSpec>>> = {
  exporter: {
    method: 'registerExporter',
    data: z.strictObject({
      id: z.string().min(1),
      mime: z.string().min(1),
      extension: z.string().min(1),
      kinds: z.array(z.string().min(1)),
      rasterized: z.boolean(),
    }),
    callables: {
      exportFrame: {
        // Always four: absent options are sent as the empty options they mean, so the
        // guest's check does not have to know which trailing argument a caller may drop.
        args: z.tuple([sceneSchema, artworkSchema, frameSchema, exportFrameOptionsSchema]),
        send: ([scene, artwork, frame, options]) => [scene, artwork, frame, options ?? {}],
        result: resultSchema(z.string()),
        failed: (problems) => err(problems),
      },
    },
  },
  'template-pack': {
    method: 'registerTemplatePack',
    data: z.strictObject({
      id: z.string().min(1),
      templates: z.array(templateManifestSchema),
      directory: z.string().min(1).optional(),
    }),
    callables: {},
  },
  'editor.command': {
    method: 'registerCommand',
    data: z.strictObject({ id: z.string().min(1), title: z.string() }),
    callables: {},
  },
  'editor.keymap': {
    method: 'registerKeymap',
    data: z.strictObject({
      id: z.string().min(1),
      bindings: z.record(z.string(), z.string()),
      mode: z.enum(['normal', 'vim']).optional(),
    }),
    callables: {},
  },
};

/**
 * Points an isolated plugin cannot register into yet, and the method that reaches each.
 *
 * `source`, `sink` and `rasterizer` carry a value whose type lives in a Node package and
 * whose methods nothing here names; `directive` and `panel` are behaviour whose shape is
 * TYTO-49's to decide. Refused by name, so a plugin learns which one, rather than
 * registering something that could never be called.
 */
export const NOT_YET_ISOLATED: Readonly<Record<string, ContributionPoint>> = {
  registerSource: 'source',
  registerSink: 'sink',
  registerRasterizer: 'rasterizer',
  registerDirective: 'directive',
  registerPanel: 'panel',
};

export function pointSpecOf(point: string): PointSpec | undefined {
  return (ISOLATED_POINTS as Readonly<Record<string, PointSpec | undefined>>)[point];
}
