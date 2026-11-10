import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

/**
 * What a template's own folder tells an agent about writing a brief for it (ADR 0186): an
 * optional `guide.md` beside `manifest.yaml`, and the `examples/*.brief` a template already
 * ships. Read as text and handed to the agent, never run; Tyto adds nothing of its own to either.
 *
 * Both are capped, and a cut says so in the text, because an agent that reads a guide cut off
 * mid-sentence with no sign of it would take the half it got for the whole.
 */

/** The file beside `manifest.yaml` that holds a template's guide. */
export const GUIDE_FILE = 'guide.md';
/** The folder of example briefs, as `tyto template new` writes it. */
export const EXAMPLES_FOLDER = 'examples';
/** A guide longer than this is cut: it is read into an agent's context whole. */
export const GUIDE_MAX_BYTES = 64 * 1024;
/** Example briefs served per template, in file-name order. */
export const EXAMPLES_MAX = 8;
/** An example longer than this is cut. */
export const EXAMPLE_MAX_BYTES = 16 * 1024;

export interface GuidanceText {
  readonly text: string;
  /** Whether the text was cut at its ceiling; the text then ends with a line that says so. */
  readonly truncated: boolean;
}

export interface GuidanceExample extends GuidanceText {
  /** The file name inside `examples/`, such as `basic.brief`. */
  readonly file: string;
}

export interface TemplateGuidance {
  readonly guide?: GuidanceText;
  readonly examples: readonly GuidanceExample[];
  /** Example briefs past {@link EXAMPLES_MAX}, not served. */
  readonly omittedExamples: number;
}

const inside = (folder: string, path: string): boolean => {
  const step = relative(folder, path);
  return step !== '' && !step.startsWith('..') && !isAbsolute(step);
};

/**
 * A file's text, followed to its real path first: a link inside a template folder that leads out
 * of it is read as no file, so a pack cannot hand an agent a file from elsewhere on the disk.
 */
async function readInside(
  folder: string,
  path: string,
  ceiling: number,
): Promise<GuidanceText | undefined> {
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    return undefined;
  }
  if (!inside(folder, real)) return undefined;
  let bytes: Buffer;
  try {
    bytes = await readFile(real);
  } catch {
    return undefined;
  }
  return cut(bytes, ceiling);
}

/** The bytes as text, cut at `ceiling` on a character boundary, with a line saying so. */
export function cut(bytes: Uint8Array, ceiling: number): GuidanceText {
  if (bytes.length <= ceiling) {
    return { text: new TextDecoder().decode(bytes), truncated: false };
  }
  let end = ceiling;
  // A continuation byte (10xxxxxx) is the middle of a character: step back to its start.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  const kept = new TextDecoder().decode(bytes.subarray(0, end));
  return {
    text: `${kept}\n\n[cut: ${String(end)} of ${String(bytes.length)} bytes shown]\n`,
    truncated: true,
  };
}

/** Reads a template folder's guide and example briefs, each capped. */
export async function readTemplateGuidance(directory: string): Promise<TemplateGuidance> {
  let folder: string;
  try {
    folder = await realpath(directory);
  } catch {
    return { examples: [], omittedExamples: 0 };
  }
  const guide = await readInside(folder, join(folder, GUIDE_FILE), GUIDE_MAX_BYTES);

  let names: string[] = [];
  try {
    names = (await readdir(join(folder, EXAMPLES_FOLDER), { withFileTypes: true }))
      .filter((entry) => !entry.isDirectory() && entry.name.toLowerCase().endsWith('.brief'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    // No examples folder is the common case, not a failure.
  }
  const examples: GuidanceExample[] = [];
  for (const file of names.slice(0, EXAMPLES_MAX)) {
    const read = await readInside(folder, join(folder, EXAMPLES_FOLDER, file), EXAMPLE_MAX_BYTES);
    if (read !== undefined) examples.push({ file, ...read });
  }
  return {
    ...(guide === undefined ? {} : { guide }),
    examples,
    omittedExamples: Math.max(0, names.length - EXAMPLES_MAX),
  };
}

/**
 * Whether a template's folder lies inside one of `folders`, real paths compared: what decides
 * that a restricted workspace's own template keeps its guidance (ADR 0186).
 */
export async function liesInside(directory: string, folders: readonly string[]): Promise<boolean> {
  const real = await realpath(directory).catch(() => directory);
  for (const folder of folders) {
    const root = await realpath(folder).catch(() => folder);
    if (real === root || inside(root, real)) return true;
  }
  return false;
}
