import { type Result, err, ok } from '@tyto/core';

import { parseBrief } from './parse-brief.js';

/**
 * A brief written from data (ADR 0172): a template's name and a value per slot, as the recipe's
 * `to-brief` hands over one row of a table.
 *
 * The value is brief text, so the inline Markdown a person wrote in a cell (`**urgente**`, a
 * trailing `\`) means what it means in a brief. `\::` is the only escape the language has
 * (ADR 0004), and it is the only one written here: a line of a value starting with `::` would
 * otherwise be read as a directive. **A `{` or a `}` is refused**, never escaped or dropped:
 * the language has no literal brace, and silently changing what a person's data says would
 * hand them a brief that differs from their sheet with nothing to say so. The recipe can fix
 * the data first with `rewrite`.
 *
 * What the language ignores is not kept: spaces around a line and blank lines inside a value
 * have no meaning in a brief (ADR 0087, ADR 0096). An empty value writes no directive, so the
 * slot keeps the template's default rather than being set to nothing.
 *
 * The written text is parsed back before it is returned, so a value the grammar cannot hold
 * (an unpaired `*`) is a problem naming its slot, and a brief that would not parse is never
 * handed to anybody to write.
 *
 * Pure: no Node, no DOM (ADR 0010).
 */
export interface BriefToWrite {
  readonly template: string;
  /** In the order they are written. */
  readonly slots: readonly BriefSlotValue[];
}

export interface BriefSlotValue {
  readonly name: string;
  readonly value: string;
}

/** Why a brief could not be written; `slot` names the value at fault, when one is. */
export interface BriefWriteProblem {
  readonly slot?: string;
  readonly problem: string;
}

const SLOT_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/u;
/** A template name YAML reads as the same plain string; anything else is written quoted. */
const PLAIN_SCALAR = /^[A-Za-z0-9][\w.-]*$/u;

interface Written {
  readonly slot: string;
  readonly from: number;
  readonly to: number;
}

export function writeBrief(brief: BriefToWrite): Result<string, readonly BriefWriteProblem[]> {
  const problems: BriefWriteProblem[] = [];
  if (brief.template.trim() === '') problems.push({ problem: 'names no template' });
  const template = PLAIN_SCALAR.test(brief.template)
    ? brief.template
    : JSON.stringify(brief.template);
  let text = `---\ntemplate: ${template}\n---\n`;
  const written: Written[] = [];
  for (const slot of brief.slots) {
    if (!SLOT_NAME.test(slot.name)) {
      problems.push({ slot: slot.name, problem: `'${slot.name}' is not a slot name` });
      continue;
    }
    const brace = /[{}]/u.exec(slot.value);
    if (brace !== null) {
      problems.push({
        slot: slot.name,
        problem: `holds '${brace[0]}', which brief text cannot hold outside a mark`,
      });
      continue;
    }
    const lines = linesOf(slot.value);
    if (lines.length === 0) continue;
    const from = text.length;
    text +=
      lines.length === 1
        ? `::${slot.name} ${lines[0] ?? ''}\n`
        : `::${slot.name}\n${lines.map((line) => `  ${line}\n`).join('')}`;
    written.push({ slot: slot.name, from, to: text.length });
  }
  if (problems.length > 0) return err(problems);

  const parsed = parseBrief(text);
  const found = parsed.ok ? parsed.diagnostics : parsed.error;
  for (const diagnostic of found) {
    if (diagnostic.severity !== 'error') continue;
    const at = diagnostic.range?.start;
    const slot = written.find((entry) => at !== undefined && at >= entry.from && at < entry.to);
    problems.push({
      ...(slot === undefined ? {} : { slot: slot.slot }),
      problem: `cannot be written as brief text: ${diagnostic.message.replace(/\.$/u, '')}`,
    });
  }
  return problems.length > 0 ? err(problems) : ok(text);
}

/** The value's lines, each trimmed, blank ones dropped, a leading `::` escaped. */
function linesOf(value: string): string[] {
  return value
    .split(/\r\n|\r|\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => (line.startsWith('::') ? `\\${line}` : line));
}
