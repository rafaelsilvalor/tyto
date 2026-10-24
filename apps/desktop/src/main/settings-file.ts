import type { Diagnostic } from '@tyto/core';
import { type JsoncText, readJsoncText } from '@tyto/io';
import type { SettingEntry, SettingMemberRange } from '@tyto/plugin-api';
import { applyEdits, modify } from 'jsonc-parser';

/**
 * `settings.json` as text a person wrote: JSON with comments, read with the place of every
 * key, and edited in place (TYTO-206, ADR 0073).
 *
 * Read by `@tyto/io`'s one JSONC reader, the one `.tyto/project.json` is read by (TYTO-350), so
 * a syntax error points at the same place in both files. Written here, by `jsonc-parser`'s
 * edits, which touch one property and leave every comment, blank line and indentation the
 * person chose where it was.
 */

const BOM = '﻿';

/** What a settings text says: its top-level keys, and why it cannot be written, if it cannot. */
export interface SettingsText {
  readonly entries: readonly SettingEntry[];
  /** `E_SETTINGS_SYNTAX`, one per problem. Non-empty means the app must not write the file. */
  readonly syntax: readonly Diagnostic[];
}

/**
 * The top-level keys of a settings text, with their ranges. Never fails: the keys the parser
 * recovered around a syntax error are still answered, beside the error.
 */
export function readSettingsText(text: string): SettingsText {
  const read = readJsoncText(text, {
    syntaxCode: 'E_SETTINGS_SYNTAX',
    notAnObject: 'it is not an object of settings',
  });
  return { entries: read.entries.map(settingEntryOf), syntax: read.syntax };
}

/**
 * A key as the settings resolver takes it: an object value's members by name, where its name
 * and its value were written, so one checked member by member can point at either (TYTO-301,
 * `statusBarColors`). Deeper than that a setting does not look.
 */
function settingEntryOf(entry: JsoncText['entries'][number]): SettingEntry {
  const { node, ...rest } = entry;
  if (node?.members === undefined) return rest;
  const memberRanges: Record<string, SettingMemberRange> = {};
  for (const member of node.members) {
    memberRanges[member.key] = {
      keyRange: member.keyRange,
      ...(member.value === undefined ? {} : { valueRange: member.value.range }),
    };
  }
  return { ...rest, memberRanges };
}

/**
 * The same text with each named key set, or removed where the value is `undefined`.
 *
 * Only those properties change. A key the person wrote and the app did not touch keeps its
 * value, its comment and its place; a new key goes at the end of the object, indented like
 * the file it joins. The caller must not call this on a text {@link readSettingsText} found
 * a syntax error in — an edit computed against a tree the parser had to guess at could land
 * anywhere.
 */
export function editSettingsText(text: string, changes: Readonly<Record<string, unknown>>): string {
  const hadBom = text.startsWith(BOM);
  let source = withoutBom(text);
  if (source.trim() === '') source = '{}';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';

  for (const [key, value] of Object.entries(changes)) {
    const edits = modify(source, [key], value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
    });
    source = applyEdits(source, edits);
  }
  return hadBom && source.startsWith(' ') ? `${BOM}${source.slice(1)}` : source;
}

/** The BOM as a space: offsets stay those of the file, and the parser stops seeing a symbol. */
function withoutBom(text: string): string {
  return text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
}
