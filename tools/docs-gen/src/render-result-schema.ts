import { renderResultSchema } from '@tyto/io';
import { z } from 'zod';

/**
 * `result.json`'s JSON Schema, emitted from the Zod schema that actually validates it.
 *
 * Emitted rather than written by hand, for the reason every generated doc in this repo
 * exists: a schema maintained in two languages is a schema that disagrees with itself, and
 * the half that would drift is the one Jacurutu reads.
 */

/** Stable across runs: the emitter is deterministic and the indentation is fixed. */
export function renderResultJsonSchema(): string {
  const schema = z.toJSONSchema(renderResultSchema);

  return `${JSON.stringify(
    {
      // Ahead of the emitted keys so a reader sees what this is before what it says.
      $id: 'https://github.com/rafaelsilvalor/tyto/blob/main/docs/render-result.schema.json',
      title: 'Tyto result.json',
      description:
        'The document Tyto writes beside the artifacts of one render (ADR 0011). ' +
        'Generated from renderResultSchema in @tyto/io by `pnpm docs:gen`.',
      ...schema,
    },
    null,
    2,
  )}\n`;
}
