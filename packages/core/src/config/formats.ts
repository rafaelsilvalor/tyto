import { z } from 'zod';

import { parseYamlConfig } from './yaml-source.js';
import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import type { FileSystem } from '../ports/file-system.js';
import { type Diagnostics, type Result, err, ok } from '../result/result.js';
import type { Size } from '../scene/primitives.js';

/**
 * `formats.yaml` — the sizes a project renders at.
 *
 * `docs/template-authoring.md` has always said format ids are "defined in the project's
 * `formats.yaml`", and a manifest's `formats` list names them. This is that file: the one
 * place a number like 1080×1920 is written, so that a template does not carry a copy and
 * two templates cannot disagree about what `story` is.
 *
 * It is also what makes `%` and `vw/vh` mean anything — both are relative to a frame, and
 * a frame's size comes from here.
 */

/**
 * An id reaches a shell as `--format <id>` and becomes `Frame.format`, so blanks,
 * whitespace and separators are refused for the same reason a template name refuses them.
 * Nothing about style is enforced.
 */
const FORMAT_ID = /^[^\s/\\]+$/u;

export const formatSchema = z.strictObject({
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  /** What a picker shows a human. The id is what everything else uses. */
  label: z.string().min(1).optional(),
});
export type FormatDefinition = z.infer<typeof formatSchema>;

/** A mapping of id to size; the file is the catalogue, with no wrapper key around it. */
export const formatsSchema = z
  .record(z.string(), formatSchema)
  .refine((formats) => Object.keys(formats).length > 0, {
    message: 'a project renders at least one format',
  })
  .superRefine((formats, context) => {
    // Checked here rather than as a key schema: Zod reports a failing record key as
    // "Invalid key in record", and the reason a key is refused is the point of refusing it.
    for (const id of Object.keys(formats)) {
      if (!FORMAT_ID.test(id)) {
        context.addIssue({
          code: 'custom',
          path: [id],
          message: `'${id}' must not be blank or contain a space or a slash`,
        });
      }
    }
  });
export type Formats = z.infer<typeof formatsSchema>;

/**
 * The catalogue, as everything downstream asks it questions.
 *
 * A lookup rather than the raw record, so a caller that wants one size does not have to
 * know the file was a mapping — and so `sizeOf` can stay the only place an unknown id is
 * distinguished from a defined one.
 */
export interface FormatCatalogue {
  /** In the order the file declares them, which is the order a picker should show. */
  list(): readonly (FormatDefinition & { readonly id: string })[];
  has(id: string): boolean;
  sizeOf(id: string): Size | undefined;
  labelOf(id: string): string | undefined;
}

export function formatCatalogue(formats: Formats): FormatCatalogue {
  return {
    list: () => Object.entries(formats).map(([id, definition]) => ({ id, ...definition })),
    has: (id) => id in formats,
    sizeOf: (id) => {
      const definition = formats[id];
      return definition === undefined ? undefined : { w: definition.w, h: definition.h };
    },
    labelOf: (id) => formats[id]?.label,
  };
}

/** Every problem in one pass, each at the key that caused it. */
export function parseFormats(source: string, path: string): Result<FormatCatalogue, Diagnostics> {
  const parsed = parseYamlConfig(source, formatsSchema, {
    syntax: (problem, range) => diagnostic('E_FORMATS_SYNTAX', { path, problem }, { range }),
    shape: (key, problem, range) =>
      diagnostic('E_FORMATS_SHAPE', { path: key, problem }, range === undefined ? {} : { range }),
  });

  return 'value' in parsed ? ok(formatCatalogue(parsed.value)) : err([...parsed.diagnostics]);
}

/**
 * Reads one file through the port and parses it.
 *
 * It reads and never executes, the same promise `TemplateRegistry` makes: a project's
 * format list is data, and nothing about looking at it should be able to run anything.
 */
export async function loadFormats(
  fileSystem: FileSystem,
  path: string,
): Promise<Result<FormatCatalogue, Diagnostics>> {
  let source: string;
  try {
    source = await fileSystem.readFile(path);
  } catch (cause) {
    return err([
      diagnostic('E_TEMPLATE_READ', {
        path,
        problem: cause instanceof Error ? cause.message : String(cause),
      }),
    ]);
  }

  return parseFormats(source, path);
}

/** The formats a manifest names that the project does not define. */
export function undefinedFormats(
  catalogue: FormatCatalogue,
  formats: readonly string[],
  template: string,
): Diagnostic[] {
  const defined = catalogue
    .list()
    .map((format) => format.id)
    .join(', ');

  return formats
    .filter((format) => !catalogue.has(format))
    .map((format) =>
      diagnostic('E_FORMAT_NOT_DEFINED', { format, template, defined: defined || 'none' }),
    );
}
