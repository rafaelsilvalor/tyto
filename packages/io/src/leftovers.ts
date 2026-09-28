import { lstat, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { type Diagnostic, type Diagnostics, diagnostic } from '@tyto/core';
import { z } from 'zod';

/**
 * Removing what Tyto wrote into a reused folder last time and did not write this time
 * (TYTO-127, ADR 0054).
 *
 * **Only a file the previous `result.json` listed can be removed, and only while it is still
 * the file Tyto wrote.** Anything else in the folder — a note, a logo, a PSD somebody dropped
 * beside the artwork — is not Tyto's to delete, and the one record of what is Tyto's is the
 * report the previous export left behind. Every removal, and every file that could have been
 * removed and was not, is a warning: a delivery folder is sent without being opened, so the
 * report is the only place somebody learns that it changed.
 */

/**
 * Just the two fields this reads, and loose about the rest.
 *
 * Deliberately not `renderResultSchema`: that one is strict so that what Tyto *writes* cannot
 * drift, and a strict read here would turn every future field into "cannot tell which files
 * it wrote" — the upgrade this exists for is exactly a folder written by an older Tyto.
 */
const previousResultSchema = z.object({
  artifacts: z.array(z.object({ name: z.string(), bytes: z.number().int().nonnegative() })),
});

type PreviousArtifact = z.infer<typeof previousResultSchema>['artifacts'][number];

/** What the previous export left, read before this export writes anything. */
export type PreviousDelivery =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'listed'; readonly artifacts: readonly PreviousArtifact[] };

/** What this export did, as far as deciding about leftovers needs to know. */
export interface LeftoverRun {
  /** The files this export wrote. */
  readonly artifacts: readonly { readonly name: string }[];
  readonly planned: number;
  readonly cancelled: boolean;
  /** Whether the run reported an error diagnostic. */
  readonly failed: boolean;
}

export async function readPreviousDelivery(resultFile: string): Promise<PreviousDelivery> {
  let text: string;
  try {
    text = await readFile(resultFile, 'utf8');
  } catch (cause) {
    // No report is a folder Tyto never finished an export into, which is the ordinary first
    // export and not something to warn about.
    if (errorCode(cause) === 'ENOENT') return { kind: 'none' };
    return { kind: 'unreadable', reason: reasonOf(cause) };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { kind: 'unreadable', reason: reasonOf(cause) };
  }

  const parsed = previousResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      kind: 'unreadable',
      reason: parsed.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`)
        .join('; '),
    };
  }
  return { kind: 'listed', artifacts: parsed.data.artifacts };
}

/**
 * Why a listed name is not a file directly inside the artwork folder, or `undefined`.
 *
 * A name in a `result.json` is text somebody can edit, so it is checked as if it were
 * hostile: `../elsewhere.png`, an absolute path, `editaveis/result.json` or `grid.png:stream`
 * would each reach something the previous export never wrote. **Refused, never normalised**:
 * a rewritten name would be a guess about which file was meant, and a guess is not a reason
 * to delete.
 */
function refusal(name: string, protectedNames: readonly string[]): string | undefined {
  if (name === '' || name === '.' || name === '..') return 'it is not a file name';
  // Both separators on every platform: a result.json written on Windows is read on Linux.
  if (/[\\/]/u.test(name) || isAbsolute(name)) return 'it names a path, not a file in this folder';
  // An NTFS stream or a drive-relative path, and neither is a file this folder holds.
  if (name.includes(':')) return 'it names a path, not a file in this folder';
  if (protectedNames.includes(name)) return 'it is the export report itself';
  return undefined;
}

export interface RemoveLeftoversOptions {
  readonly previous: PreviousDelivery;
  /** The folder the artwork is in, which the listed names are relative to. */
  readonly artifacts: string;
  /** Names in that folder that belong to the export itself and are never artwork. */
  readonly protectedNames: readonly string[];
  readonly run: LeftoverRun;
}

export async function removeLeftovers(options: RemoveLeftoversOptions): Promise<Diagnostics> {
  const { previous, run } = options;
  if (previous.kind === 'none') return [];
  if (previous.kind === 'unreadable') {
    return [diagnostic('W_PREVIOUS_RESULT_UNREADABLE', { reason: previous.reason })];
  }

  const written = new Set(run.artifacts.map((artifact) => artifact.name));
  // Incomplete means the older file may be the only one of that artwork there is: a failed
  // or cancelled export that removed it would leave the delivery with less than before.
  const complete = !run.failed && !run.cancelled && run.artifacts.length === run.planned;

  const warnings: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const listed of previous.artifacts) {
    const { name } = listed;
    if (written.has(name) || seen.has(name)) continue;
    seen.add(name);

    const refused = refusal(name, options.protectedNames);
    if (refused !== undefined) {
      warnings.push(diagnostic('W_LEFTOVER_KEPT', { file: name, reason: `refused, ${refused}` }));
      continue;
    }

    const path = join(options.artifacts, name);
    let size: number;
    try {
      const entry = await lstat(path);
      if (!entry.isFile()) {
        warnings.push(
          diagnostic('W_LEFTOVER_KEPT', { file: name, reason: 'it is not a plain file' }),
        );
        continue;
      }
      size = entry.size;
    } catch (cause) {
      // Already gone: somebody tidied the folder, and there is nothing left to deliver.
      if (errorCode(cause) === 'ENOENT') continue;
      warnings.push(diagnostic('W_LEFTOVER_KEPT', { file: name, reason: reasonOf(cause) }));
      continue;
    }

    if (!complete) {
      warnings.push(
        diagnostic('W_LEFTOVER_KEPT', {
          file: name,
          reason: 'this export did not finish, so the older file may be the only copy there is',
        }),
      );
      continue;
    }

    // The size guard. A file whose size is not the one Tyto recorded is a file somebody
    // replaced by hand under the same name, and that is theirs now.
    if (size !== listed.bytes) {
      warnings.push(
        diagnostic('W_LEFTOVER_KEPT', {
          file: name,
          reason: `it changed after Tyto wrote it (${listed.bytes} bytes then, ${size} now)`,
        }),
      );
      continue;
    }

    try {
      await rm(path);
      warnings.push(diagnostic('W_LEFTOVER_REMOVED', { file: name }));
    } catch (cause) {
      // Windows refuses to delete a file another program holds open. The export itself
      // succeeded, so this is a warning with the operating system's reason, not a failure.
      warnings.push(diagnostic('W_LEFTOVER_KEPT', { file: name, reason: reasonOf(cause) }));
    }
  }

  return warnings;
}

function errorCode(cause: unknown): string | undefined {
  return typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined;
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
