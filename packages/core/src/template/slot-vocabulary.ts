import { readYaml, rangeAt, withRange } from '../config/yaml-source.js';
import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import type { Slot, TemplateManifest } from './manifest.js';

/**
 * The standard slot vocabulary, checked (`docs/slot-vocabulary.md`, TYTO-158).
 *
 * Every rule here is one of the three the document's "What a check can enforce" section
 * writes, and nothing else: a reserved name with the wrong shape, a repeatable slot not
 * named `lamina`, and a name from the closed synonym table. **A name on neither list is
 * never flagged** — that is what keeps domain names (`disciplina`, `lista`) free — so there
 * is deliberately no edit distance, no plural folding and no prefix matching here. Growing
 * what this knows is a change to the document first, then to these tables.
 *
 * It is a separate pass from `parseManifest` on purpose. A manifest that ignores the
 * convention is still a valid manifest (the vocabulary sits on top of ADR 0005, it does not
 * change it), and the only person who can act on the warning is the one writing the
 * template — so `tyto template check` asks for it, and a render, the desktop and the
 * registry never do. A brief writer warned about a template's naming can do nothing
 * with it.
 *
 * Every finding is a warning and never fatal (ADR 0025): nothing about the artwork is
 * wrong, only the word the brief will have to write.
 */

/** The one repeatable name: one occurrence is one artwork. */
const LAMINA = 'lamina';

/** `docs/slot-vocabulary.md`, "What a check can enforce", item 3 — closed, verbatim. */
const SYNONYMS: Readonly<Record<string, string>> = {
  ilustracao: 'imagem',
  emblema: 'imagem',
  foto: 'imagem',
  figura: 'imagem',
  slide: LAMINA,
  item: LAMINA,
  pagina: LAMINA,
  card: LAMINA,
  cor: 'tom',
  tema: 'tom',
  variante: 'tom',
  'titulo-principal': 'titulo',
  manchete: 'titulo',
};

interface ReservedShape {
  /** The shape the document fixes, as the message says it. */
  readonly expected: string;
  readonly fits: (slot: Slot, manifest: TemplateManifest, name: string) => boolean;
}

/** `docs/slot-vocabulary.md`, "The list", and item 1 of what a check can enforce. */
const RESERVED: Readonly<Record<string, ReservedShape>> = {
  titulo: {
    expected: 'type: rich-text, required: true',
    fits: (slot) => slot.type === 'rich-text' && slot.required,
  },
  subtitulo: { expected: 'type: rich-text', fits: (slot) => slot.type === 'rich-text' },
  chamada: { expected: 'type: rich-text', fits: (slot) => slot.type === 'rich-text' },
  imagem: { expected: 'type: image', fits: (slot) => slot.type === 'image' },
  // The seal art glued to the foot of a carousel's last grid (TYTO-201).
  selo: { expected: 'type: image', fits: (slot) => slot.type === 'image' },
  // The adjustment is what overrides `tom` on one lamina, so it is owed only when there is a
  // lamina to override it on: a one-artwork template with a plain `tom` enum is complete.
  tom: {
    expected: 'type: enum, and an adjustment of the same name when a slot repeats',
    fits: (slot, manifest, name) =>
      slot.type === 'enum' &&
      (name in manifest.adjustments || !Object.values(manifest.slots).some((any) => any.repeat)),
  },
  [LAMINA]: { expected: 'repeat: true', fits: (slot) => slot.repeat },
};

/**
 * One warning per slot at most, at the slot's own entry in `manifest.yaml`.
 *
 * `source` is the manifest's text, read again only to place each warning; the rules decide
 * on the parsed manifest alone. When a slot breaks two rules — `item` that repeats is both
 * a synonym and a repeatable slot not named `lamina` — the synonym is reported, because its
 * advice is the more specific of the two and both say the same rename.
 */
export function checkSlotVocabulary(manifest: TemplateManifest, source: string): Diagnostic[] {
  const { document } = readYaml(source);
  const warnings: Diagnostic[] = [];

  for (const [name, slot] of Object.entries(manifest.slots)) {
    const finding = findingFor(name, slot, manifest);
    if (finding === undefined) continue;
    warnings.push(
      diagnostic(
        'W_SLOT_VOCABULARY',
        { slot: name, ...finding },
        withRange(rangeAt(document, ['slots', name])),
      ),
    );
  }

  return warnings;
}

function findingFor(
  name: string,
  slot: Slot,
  manifest: TemplateManifest,
): { readonly problem: string; readonly suggestion: string } | undefined {
  const standard = SYNONYMS[name];
  if (standard !== undefined) {
    return {
      problem: `is a known synonym of the standard name '${standard}'`,
      suggestion: 'rename it, and every brief that sets it',
    };
  }

  const reserved = RESERVED[name];
  if (reserved !== undefined && !reserved.fits(slot, manifest, name)) {
    return {
      problem: `is a reserved name, and the standard fixes its shape as ${reserved.expected}`,
      suggestion: `give '${name}' that shape, or a domain name if it plays another role`,
    };
  }

  if (slot.repeat && name !== LAMINA) {
    return {
      problem: `repeats, and the one repeatable slot's standard name is '${LAMINA}'`,
      suggestion: `rename it to '${LAMINA}'`,
    };
  }

  return undefined;
}
