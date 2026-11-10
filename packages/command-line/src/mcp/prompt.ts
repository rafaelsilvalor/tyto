import type { ServedGuidance, TemplateSummary } from './session.js';

/**
 * The text of the `model_brief` prompt (ADR 0186): how to shape raw copy into a brief, the steps
 * in Tyto's own tools, followed by what the chosen template's folder says about itself.
 *
 * Everything here is generic on purpose. What a piece is called, which line of copy goes in which
 * slot, how a list splits into slides: that is the template author's, in the template's own
 * `guide.md` and examples, and the repository is public. This file says only how to use the
 * tools.
 */

/** The URI of a template's guide, as the server registers it. */
export const guideUri = (template: string): string =>
  `tyto://template/${encodeURIComponent(template)}/guide`;

/** The URI of one example brief of a template. */
export const exampleUri = (template: string, file: string): string =>
  `tyto://template/${encodeURIComponent(template)}/examples/${encodeURIComponent(file)}`;

const STEPS = [
  'Keep the words of the copy. Do not invent facts, names, dates or numbers it does not give; if something a required slot needs is missing, say so instead of filling it.',
  "Put each part of the copy in the slot the template declares for it, within the slot's limits (min and max count characters, or occurrences on a repeatable slot), and only the adjustments the template lists.",
  'Start from the skeleton below. Follow the guide and the examples where they say how this template is written.',
  'Run check_brief with the text and fix every error until it answers ok; read each warning and fix it when the copy allows.',
  'Run render_preview on one format and look at the image: text cut off, an overflow, or an empty area are reasons to change the brief.',
  'Show the brief to the person. Write it to a file only when asked, with write_brief: dry_run first, then the sha256 it answers to replace a file.',
];

/** A fence that the text inside cannot close: one backtick more than its longest run. */
function fenced(text: string, language = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text.endsWith('\n') ? text : `${text}\n`}${fence}`;
}

export interface TemplateForPrompt {
  readonly guidance: ServedGuidance;
  /** `describe_template`'s answer: formats, slots, adjustments and skeleton. */
  readonly description: Record<string, unknown>;
}

/** The prompt for one template. */
export function modelBriefPrompt(copy: string, template: TemplateForPrompt): string {
  const { guidance, description } = template;
  const lines: string[] = [
    `Shape the copy at the end into a Tyto brief for the template '${guidance.name}'.`,
    '',
    '## Steps',
    '',
    ...STEPS.map((step, index) => `${String(index + 1)}. ${step}`),
    '',
    `## The template '${guidance.name}'`,
    '',
  ];
  if (guidance.description !== undefined) lines.push(guidance.description, '');
  const { skeleton, ...manifest } = description;
  lines.push(
    'Its formats, slots and adjustments, as describe_template answers them:',
    '',
    fenced(JSON.stringify(manifest, null, 2), 'json'),
    '',
  );
  if (typeof skeleton === 'string') {
    lines.push('The skeleton a new brief starts from:', '', fenced(skeleton, 'brief'), '');
  }

  if (guidance.withheld !== undefined) {
    lines.push('## Guide and examples', '', `Not served: ${guidance.withheld}.`, '');
  } else {
    lines.push('## Guide', '');
    lines.push(
      guidance.guide === undefined
        ? 'This template ships no guide.md; go by its slots and examples.'
        : guidance.guide.text.trimEnd(),
      '',
    );
    lines.push('## Examples', '');
    if (guidance.examples.length === 0) lines.push('This template ships no example briefs.', '');
    for (const example of guidance.examples) {
      lines.push(`### ${example.file}`, '', fenced(example.text, 'brief'), '');
    }
    if (guidance.omittedExamples > 0) {
      lines.push(`${String(guidance.omittedExamples)} more example briefs are not shown here.`, '');
    }
  }

  lines.push('## The copy', '', fenced(copy), '');
  return lines.join('\n');
}

/** The prompt when no template was named: the list to choose from, and how to go on. */
export function chooseTemplatePrompt(copy: string, templates: readonly TemplateSummary[]): string {
  const lines = [
    'Shape the copy at the end into a Tyto brief. First choose the template it is for.',
    '',
    '## Templates',
    '',
    ...(templates.length === 0
      ? ['No template is available in this folder.']
      : templates.map(
          (template) =>
            `- ${template.name}${template.description === undefined ? '' : ` — ${template.description}`} (formats: ${template.formats.join(', ')})`,
        )),
    '',
    '## Next',
    '',
    "Pick the template whose description fits the copy; if two fit, ask the person. Then get this prompt again with that template, or read the template's guide resource and call describe_template, and follow the steps it gives.",
    '',
    '## The copy',
    '',
    fenced(copy),
    '',
  ];
  return lines.join('\n');
}
