import {
  type Diagnostics,
  type Directive,
  type ExpandedInline,
  type Inline,
  type TemplateReport,
  artworkSchema,
  err,
  frameSchema,
  ok,
  sceneSchema,
  sizeSchema,
  templateManifestSchema,
  templateReportCodes,
} from '@tyto/core';
import { z } from 'zod';

import type { ContributionPoint } from '../manifest.js';
import type { GuestFaces, ShippedFace } from './faces.js';
import { resultSchema } from './protocol.js';

/**
 * Which contributions an isolated plugin can make, and what crosses for each (ADR 0041).
 *
 * A contribution is data plus, sometimes, functions. The data crosses as it is and is
 * validated by the host against `data`; each function stays in the guest and crosses as a
 * handle the host calls back. **A function is callable only if it is named here**, with
 * the schema its arguments are checked against in the guest and the schema its answer is
 * checked against in the host — so adding a callable to a point is one entry, which is how
 * a directive got its `transform` (TYTO-49).
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
  /** A contribution may leave it out: a pack of markup templates registers no `build`. */
  readonly optional?: boolean;
  /**
   * In the guest, after `args` accepted them: what the plugin's function is handed. Absent,
   * it is handed the arguments as they crossed. A template's `build` is handed a context
   * whose `measure` is rebuilt here, because a function does not cross (ADR 0048).
   */
  receive?(args: readonly unknown[], guest: GuestState): readonly unknown[];
  /**
   * In the guest: what the plugin's answer becomes on the wire, given the arguments
   * `receive` handed it — which is where a call's own state, such as a template's reports,
   * is found again. Absent, the answer crosses as it is.
   */
  reply?(value: unknown, handed: readonly unknown[]): unknown;
}

/** What a guest keeps between calls, for the callables that need more than their arguments. */
export interface GuestState {
  readonly faces: GuestFaces;
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

const rangeSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

type RangedInline = Inline;

/** An AST inline, positions included: what the guest checks a directive's body against. */
const rangedInlineSchema: z.ZodType<RangedInline> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), value: z.string(), range: rangeSchema }),
    z.strictObject({
      kind: z.literal('bold'),
      children: z.array(rangedInlineSchema),
      range: rangeSchema,
    }),
    z.strictObject({
      kind: z.literal('italic'),
      children: z.array(rangedInlineSchema),
      range: rangeSchema,
    }),
    z.strictObject({ kind: z.literal('break'), range: rangeSchema }),
    z.strictObject({
      kind: z.literal('mark'),
      key: z.string(),
      value: z.string(),
      children: z.array(rangedInlineSchema),
      range: rangeSchema,
    }),
  ]),
) as z.ZodType<RangedInline>;

/** A plugin directive as parsed, which is what `transform` is handed (ADR 0043). */
const directiveSchema = z.strictObject({
  name: z.string().min(1),
  namespace: z.string().min(1),
  adjustments: z.array(
    z.strictObject({ name: z.string(), value: z.string().optional(), range: rangeSchema }),
  ),
  body: z.array(rangedInlineSchema),
  range: rangeSchema,
  nameRange: rangeSchema,
}) as unknown as z.ZodType<Directive>;

/** An inline as a plugin answers it: the AST's shapes, and no positions to lie with. */
const expandedInlineSchema: z.ZodType<ExpandedInline> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), value: z.string() }),
    z.strictObject({ kind: z.literal('bold'), children: z.array(expandedInlineSchema) }),
    z.strictObject({ kind: z.literal('italic'), children: z.array(expandedInlineSchema) }),
    z.strictObject({ kind: z.literal('break') }),
    z.strictObject({
      kind: z.literal('mark'),
      key: z.string(),
      value: z.string(),
      children: z.array(expandedInlineSchema),
    }),
  ]),
) as z.ZodType<ExpandedInline>;

/**
 * A replacement slot directive. Strict, so a `namespace` — which would make it another
 * plugin directive — or a `range` is refused as `E_PLUGIN_PROTOCOL` rather than dropped.
 */
const expandedDirectiveSchema = z.strictObject({
  name: z.string().min(1),
  adjustments: z
    .array(z.strictObject({ name: z.string().min(1), value: z.string().optional() }))
    .optional(),
  body: z.array(expandedInlineSchema),
});

const exportFrameOptionsSchema = z.strictObject({ textAsPaths: z.boolean().optional() });

/**
 * A `TemplateCall`: the context a template is built with, less `measure`, which the guest
 * rebuilds (ADR 0048). `slots` is Tyto's own `ResolvedSlot` record, checked for being one;
 * its shape is the host's to guarantee, and nothing a plugin wrote produced it.
 */
const templateCallSchema = z.strictObject({
  format: z.string().min(1),
  size: sizeSchema,
  idPrefix: z.string().min(1),
  artwork: z.strictObject({
    id: z.string().min(1),
    index: z.number().int().nonnegative(),
    count: z.number().int().positive(),
  }),
  slots: z.record(z.string(), z.unknown()),
  adjustments: z.record(z.string(), z.union([z.string(), z.literal(true)])),
});

/**
 * A template's report, as a plugin may send it back (ADR 0058): one of the closed list of
 * codes and its own numbers, nothing else — the host writes the diagnostic, so a plugin
 * cannot put an error, a message or a range of its choosing into the author's run.
 */
const templateReportSchema = z.strictObject({
  code: z.enum(templateReportCodes),
  overflow: z.number().nonnegative(),
});

/** `TemplateAnswer`: the frame, and the reports beside it, as a list that is always there. */
const templateAnswerSchema = z.strictObject({
  frame: frameSchema,
  reports: z.array(templateReportSchema),
});

/**
 * The reports of the calls in flight, by the context each was handed. Keyed by the context
 * rather than kept in `GuestState`, because two builds may be awaiting at once and each
 * must cross back with its own.
 */
const reportsOf = new WeakMap<object, TemplateReport[]>();

const shippedFaceSchema = z.strictObject({
  face: z.strictObject({
    family: z.string().min(1),
    weight: z.number(),
    style: z.enum(['normal', 'italic']),
  }),
  bytes: z.instanceof(Uint8Array),
});

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
    callables: {
      // `build(template, call, faces)` on the host's side; the plugin's own function is
      // `build(template, context)` and returns a frame, which crosses as a result so a
      // throw and an answer arrive in one shape (ADR 0048) — beside the reports the
      // template made while it built (ADR 0058).
      build: {
        args: z.tuple([z.string().min(1), templateCallSchema, z.array(shippedFaceSchema)]),
        send: ([template, call, faces]) => [template, call, faces ?? []],
        result: resultSchema(templateAnswerSchema),
        failed: (problems) => err(problems),
        optional: true,
        receive: ([template, call, faces], guest) => {
          guest.faces.add(faces as readonly ShippedFace[]);
          const reports: TemplateReport[] = [];
          const context = {
            ...(call as object),
            measure: guest.faces.measure,
            report: (report: TemplateReport) => {
              reports.push(report);
            },
          };
          reportsOf.set(context, reports);
          return [template, context];
        },
        reply: (frame, [, context]) => {
          const reports =
            typeof context === 'object' && context !== null ? reportsOf.get(context) : undefined;
          return ok({ frame, reports: reports ?? [] });
        },
      },
    },
  },
  directive: {
    method: 'registerDirective',
    data: z.strictObject({ id: z.string().min(1), names: z.array(z.string().min(1)) }),
    callables: {
      transform: {
        args: z.tuple([directiveSchema]),
        send: ([directive]) => [directive],
        result: resultSchema(z.array(expandedDirectiveSchema)),
        failed: (problems) => err(problems),
      },
    },
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
  // Data: the page is a file the host serves, and the page talks to the host through the
  // window's bridge, never to the plugin's process (ADR 0045).
  panel: {
    method: 'registerPanel',
    data: z.strictObject({
      id: z.string().min(1),
      title: z.string().min(1),
      location: z.enum(['left', 'right', 'bottom']).optional(),
      entry: z.string().min(1).max(500),
    }),
    callables: {},
  },
};

/**
 * Points an isolated plugin cannot register into yet, and the method that reaches each.
 *
 * `source`, `sink` and `rasterizer` carry a value whose type lives in a Node package and
 * whose methods nothing here names. Refused by name, so a plugin learns which one, rather
 * than registering something that could never be called.
 */
export const NOT_YET_ISOLATED: Readonly<Record<string, ContributionPoint>> = {
  registerSource: 'source',
  registerSink: 'sink',
  registerRasterizer: 'rasterizer',
};

export function pointSpecOf(point: string): PointSpec | undefined {
  return (ISOLATED_POINTS as Readonly<Record<string, PointSpec | undefined>>)[point];
}
