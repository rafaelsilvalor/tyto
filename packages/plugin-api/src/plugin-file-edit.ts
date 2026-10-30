import { type Result, err, hasErrors, ok } from '@tyto/core';
import { isMap, isScalar, parse, parseDocument } from 'yaml';

import { type PluginFile, type PluginFileSource, parsePluginFile } from './plugin-files.js';

/**
 * Writing a plugin file somebody owns (ADR 0162): the gallery adds an entry or moves a ref.
 *
 * **The original bytes are spliced, never re-serialized.** A document written back through
 * a YAML library loses what the person chose — a quote style, a blank line, a comment beside
 * a key — so each edit inserts or replaces exactly one span of text and leaves the rest as it
 * was. Then the result is read again and every entry the edit did not mean to change must read
 * as it did before; anything else refuses the edit and the file is not written.
 */

/** A YAML scalar as it should be written: plain when YAML reads it back as itself. */
function scalar(value: string): string {
  try {
    if (parse(value) === value && !value.includes('#') && value.trim() === value) return value;
  } catch {
    // Not plain YAML on its own, so it is quoted below.
  }
  return JSON.stringify(value);
}

/** An entry as data, ranges dropped, so two readings of one entry compare equal. */
function withoutRanges(value: unknown): string {
  return JSON.stringify(value, (key, inner: unknown) =>
    key === 'range' || key === 'aliasRange' ? undefined : inner,
  );
}

function read(text: string, file: string): Result<PluginFile, string> {
  const result = parsePluginFile(text, file);
  if (result.value === undefined || hasErrors(result.diagnostics)) {
    const [first] = result.diagnostics;
    return err(first?.message ?? 'it does not read as a plugin file');
  }
  return ok(result.value);
}

/** The text of a new file that holds one plugin. */
export function newPluginFileText(source: PluginFileSource): string {
  return `version: 1\nplugin:\n  source:\n    git: ${scalar(source.git)}\n    ref: ${scalar(source.ref)}\n`;
}

function templateBlock(names: readonly string[], source: PluginFileSource, indent: string): string {
  return names
    .map(
      (name) =>
        `${indent}${scalar(name)}:\n` +
        `${indent}${indent}source:\n` +
        `${indent}${indent}${indent}git: ${scalar(source.git)}\n` +
        `${indent}${indent}${indent}ref: ${scalar(source.ref)}\n`,
    )
    .join('');
}

/** The offset just past the end of the line `offset` is on. */
function endOfLine(text: string, offset: number): number {
  const newline = text.indexOf('\n', offset);
  return newline === -1 ? text.length : newline + 1;
}

/** How far the first key of a block mapping is indented, read from the text. */
function indentOf(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return text.slice(lineStart, offset);
}

/**
 * Adds templates from one source to a file that holds templates, or makes the file.
 *
 * The new entries go after the last one, indented as the file's own entries are. A file whose
 * `templates:` is written inline (`templates: { … }`) is refused rather than rewritten.
 */
export function addTemplateEntries(
  text: string | undefined,
  file: string,
  names: readonly string[],
  source: PluginFileSource,
): Result<string, string> {
  if (text === undefined || text.trim() === '') {
    return ok(`version: 1\ntemplates:\n${templateBlock(names, source, '  ')}`);
  }
  const before = read(text, file);
  if (!before.ok) return before;
  if (before.value.plugin !== undefined) return err('it holds a plugin, not templates');
  const taken = names.find((name) => before.value.templates.some((entry) => entry.name === name));
  if (taken !== undefined) return err(`it already has an entry named ${taken}`);

  const document = parseDocument(text);
  const root = document.contents;
  const templates = isMap(root) ? root.get('templates', true) : undefined;
  if (!isMap(templates) || templates.flow || templates.items.length === 0) {
    return err('its templates are written inline; add the entry by hand');
  }
  const firstKey = templates.items[0]?.key;
  const keyStart = isScalar(firstKey) ? firstKey.range?.[0] : undefined;
  const end = templates.range?.[1];
  if (keyStart === undefined || end === undefined) return err('its templates could not be located');
  // The mapping's value ends on its last entry's last line; insert on the next one.
  const insertAt = endOfLine(text, Math.max(end - 1, keyStart));
  const separator = insertAt === text.length && !text.endsWith('\n') ? '\n' : '';
  const block = templateBlock(names, source, indentOf(text, keyStart));
  const next = `${text.slice(0, insertAt)}${separator}${block}${text.slice(insertAt)}`;

  const after = read(next, file);
  if (!after.ok) return err(`the edit would not read back: ${after.error}`);
  const kept = after.value.templates.filter((entry) => !names.includes(entry.name));
  const added = after.value.templates.filter((entry) => names.includes(entry.name));
  const unchanged = withoutRanges(kept) === withoutRanges(before.value.templates);
  const landed =
    added.length === names.length &&
    added.every((entry) => entry.source.git === source.git && entry.source.ref === source.ref);
  if (!unchanged || !landed) return err('the edit would change entries it did not mean to');
  return ok(next);
}

/**
 * Moves one entry's `ref`, replacing only the ref's own text.
 *
 * `template` names the entry in a file that holds templates; absent, the file holds a plugin.
 */
export function moveEntryRef(
  text: string,
  file: string,
  template: string | undefined,
  ref: string,
): Result<string, string> {
  const before = read(text, file);
  if (!before.ok) return before;
  const path =
    template === undefined ? ['plugin', 'source', 'ref'] : ['templates', template, 'source', 'ref'];
  const node = parseDocument(text).getIn(path, true);
  const range = isScalar(node) ? (node.range ?? undefined) : undefined;
  if (range === undefined) return err(`it has no ${path.join('.')} to move`);
  const next = `${text.slice(0, range[0])}${scalar(ref)}${text.slice(range[1])}`;

  const after = read(next, file);
  if (!after.ok) return err(`the edit would not read back: ${after.error}`);
  const expected: PluginFile =
    template === undefined
      ? {
          ...before.value,
          ...(before.value.plugin === undefined
            ? {}
            : { plugin: { source: { ...before.value.plugin.source, ref } } }),
        }
      : {
          ...before.value,
          templates: before.value.templates.map((entry) =>
            entry.name === template ? { ...entry, source: { ...entry.source, ref } } : entry,
          ),
        };
  if (withoutRanges(after.value) !== withoutRanges(expected)) {
    return err('the edit would change more than the ref');
  }
  return ok(next);
}
