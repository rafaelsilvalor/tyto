import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';

/**
 * What the external-art guide dialog decides without a DOM (TYTO-741, ADR 0222): which rows start
 * checked, where the line citing a file for an uncited slot goes in the brief, and what a write's
 * answer says to a person.
 */

export type GuideList = IpcResponse<'guide:candidates'>;
export type GuideRow = Extract<GuideList, { ok: true }>['guides'][number];

/**
 * What writing answered: main's own answer, or `not-saved` when the brief had unsaved edits and
 * the person did not save it, so main was never asked (decision 5).
 */
export type GuideWriteResult = IpcResponse<'guide:write'> | { readonly outcome: 'not-saved' };

/**
 * The guides checked when the dialog opens: the missing ones. A guide already there may hold paint
 * (decision 4), so writing it again is something a person asks for, never the default.
 */
export function defaultChecked(guides: readonly GuideRow[]): ReadonlySet<string> {
  return new Set(guides.filter((guide) => !guide.exists).map((guide) => guide.name));
}

/** One insertion into the brief's text: `insert` at offset `from`. */
export interface GuideLineInsertion {
  readonly from: number;
  readonly insert: string;
}

const FENCE = /^---[ \t]*$/u;

/**
 * Where the line `tyto guide --list` offers for an uncited slot goes (ADR 0222's note of
 * 2026-11-19). A `slot: file` line is a frontmatter key, so it goes just before the closing `---`
 * (a brief with no frontmatter gets one); a `::slot` directive goes at the end of the brief, after
 * a blank line. The line's own line breaks follow the brief's.
 */
export function guideLineInsertion(text: string, line: string): GuideLineInsertion {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const written = line.replace(/\n/gu, newline);
  if (line.startsWith('::')) {
    const trimmed = text.replace(/(?:\r?\n)+$/u, '');
    const from = trimmed.length;
    return { from, insert: `${trimmed === '' ? '' : newline + newline}${written}${newline}` };
  }
  const lines = text.split(/\r?\n/u);
  if (lines.length > 1 && FENCE.test(lines[0] ?? '')) {
    let offset = (lines[0] ?? '').length + newline.length;
    for (let index = 1; index < lines.length; index += 1) {
      const current = lines[index] ?? '';
      if (FENCE.test(current)) return { from: offset, insert: `${written}${newline}` };
      offset += current.length + newline.length;
    }
  }
  return { from: 0, insert: `---${newline}${written}${newline}---${newline}` };
}

/** The sentence under a write, by main's answer: for a written one, how it reached the person. */
export function writeOutcomeKey(result: GuideWriteResult): CatalogueKey {
  switch (result.outcome) {
    case 'not-saved':
      return 'guide.result.notSaved';
    case 'declined':
      return 'guide.result.declined';
    case 'failed':
      return 'guide.result.failed';
    case 'refused':
      return result.reason === 'unsaved' ? 'guide.result.notSaved' : 'guide.result.refused';
    case 'written':
      switch (result.open) {
        case 'opened':
          return 'guide.result.opened';
        case 'no-program':
          return 'guide.result.noProgram';
        case 'restricted':
          return 'guide.result.restricted';
      }
  }
}
