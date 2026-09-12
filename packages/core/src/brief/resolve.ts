import type { BriefAst, Directive, RichText } from './ast.js';
import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import { didYouMean } from '../diagnostics/suggest.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import { type Diagnostics, type Result, err, fromDiagnostics } from '../result/result.js';
import type { AssetRef } from '../scene/primitives.js';
import type { SourceRange } from '../source/range.js';
import type { Slot, TemplateManifest } from '../template/manifest.js';
import type { TemplateRegistry } from '../template/registry.js';

/**
 * `BriefAst` × manifest → `ResolvedBrief` (`docs/architecture.md`, `docs/brief-language.md`).
 *
 * The parser knows the language and nothing about templates; the compiler knows a template
 * and nothing about the brief that fed it. This is the stage that holds both, and every
 * question it can answer is a question neither of its neighbours can: whether `::titulo`
 * names a real slot, whether `{destaque}` is allowed on it, whether the file
 * `imagem: ./prof-ana.png` points at exists.
 *
 * It reports everything it finds in one pass. An author fixing a brief wants the list, not
 * the first line of it — the two exceptions are a missing or unknown template, where there
 * is no manifest to ask anything else against.
 */

export interface ResolvedAdjustment {
  readonly name: string;
  readonly value?: string;
  readonly range: SourceRange;
}

/** Typed by the slot's declared type, so `compile` never re-reads the manifest to branch. */
export type SlotValue =
  | { readonly kind: 'rich-text'; readonly text: RichText }
  | { readonly kind: 'image'; readonly asset: AssetRef }
  | { readonly kind: 'enum'; readonly value: string };

export interface ResolvedSlot {
  readonly name: string;
  readonly value: SlotValue;
  readonly adjustments: readonly ResolvedAdjustment[];
  /** Where the brief set it. Absent when the value came from the manifest's `default`. */
  readonly range?: SourceRange;
}

/** One occurrence of the repeatable slot; each becomes an `Artwork` in `compile`. */
export interface ResolvedArtwork {
  readonly index: number;
  readonly slot: ResolvedSlot;
}

export interface ResolvedBrief {
  readonly template: string;
  readonly formats: readonly string[];
  /** Every non-repeating slot that has a value, by name. */
  readonly slots: Readonly<Record<string, ResolvedSlot>>;
  readonly artworks: readonly ResolvedArtwork[];
  /** Deduplicated, in the order the brief referenced them — what `Scene.assets` wants. */
  readonly assets: readonly AssetRef[];
}

export interface ResolveOptions {
  readonly registry: TemplateRegistry;
  readonly assets: AssetResolver;
  /** `--template` on the CLI, for a brief whose frontmatter names none. */
  readonly template?: string;
  /**
   * `--formats` on the CLI, for a brief whose frontmatter lists none.
   *
   * A fallback and not an override, which is `template`'s rule above and therefore the
   * one rule a reader has to learn: what the brief says about itself wins over what the
   * command line says about this run. Each entry is checked against the manifest the same
   * way the frontmatter's are, so a format the template does not render is
   * `E_UNKNOWN_FORMAT` whichever of the two named it.
   */
  readonly formats?: readonly string[];
  /**
   * The slots the chosen template actually renders, when the caller knows them.
   *
   * A manifest says which slots may be set; only the template body says which are drawn,
   * and reading a template body is `compile`'s job, not this stage's. A caller that has
   * already parsed one passes the set and gets `W_UNUSED_SLOT` for a slot the brief filled
   * in for nothing; a caller that has not passes nothing and the warning stays silent
   * rather than being guessed at.
   */
  readonly renderedSlots?: readonly string[];
}

/** Reserved frontmatter keys: metadata about the brief, not slots of the template. */
const RESERVED = new Set(['template', 'formats']);

function plainText(text: RichText): string {
  return text
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
          return inline.value;
        case 'break':
          return '\n';
        default:
          return plainText(inline.children);
      }
    })
    .join('');
}

function unknownSlot(
  name: string,
  manifest: TemplateManifest,
  range: SourceRange | undefined,
): Diagnostic {
  const declared = Object.keys(manifest.slots);
  const suggestion = didYouMean(name, declared);
  return diagnostic(
    'E_UNKNOWN_SLOT',
    { slot: name, template: manifest.name, declared: declared.join(', ') },
    {
      ...(range === undefined ? {} : { range }),
      ...(suggestion === undefined ? {} : { hint: `Did you mean '${suggestion}'?` }),
    },
  );
}

function badValue(slot: string, problem: string, range: SourceRange | undefined): Diagnostic {
  return diagnostic('E_BAD_SLOT_VALUE', { slot, problem }, range === undefined ? {} : { range });
}

/**
 * Inline markup a frontmatter scalar cannot express, and the shortest way to name it.
 *
 * A frontmatter value is YAML, so it reaches a rich-text slot as one run of plain text:
 * `titulo: Direito **Constitucional**` renders the asterisks, where the same words after
 * `::titulo` come out bold. Accepting the scalar stays — `docs/brief-language.md` calls the
 * frontmatter "metadata and scalar slots" and a one-line title is why — so the answer is to
 * say so rather than to refuse it or to parse it (TYTO-59).
 *
 * Deliberately conservative, and it has to be: `core` may not import `brief-lang`, so this
 * is a second and cruder reader of the same syntax. A warning that fired on `2 * 3` would
 * be worse than no warning at all, so a lone `*` is not italic — italic takes two, a mark
 * takes its closer, and nothing here guesses.
 */
const FRONTMATTER_MARKUP: readonly (readonly [RegExp, string])[] = [
  [/\*\*/u, '**'],
  [/\*[^*]*\*/u, '*'],
  [/\{[a-zA-Z_][a-zA-Z0-9_-]*:[^}]*\}[\s\S]*\{\/\}/u, '{key:value}…{/}'],
  [/\\$/u, '\\'],
];

function markupIn(plain: string): string | undefined {
  return FRONTMATTER_MARKUP.find(([pattern]) => pattern.test(plain))?.[1];
}

/** What the brief said a slot is, before the manifest has had its say. */
interface Candidate {
  readonly name: string;
  readonly text: RichText;
  readonly adjustments: readonly ResolvedAdjustment[];
  readonly range: SourceRange;
  /**
   * Where the name was written, which is not always where the value was.
   *
   * A wrong slot name is a problem with the name: `::rodape` followed by three lines of
   * body is one misspelled word, and `range` would underline all four lines. A frontmatter
   * key is its own name, so there the two spans are the same one.
   */
  readonly nameRange: SourceRange;
}

function candidateOf(directive: Directive): Candidate {
  return {
    name: directive.name,
    text: directive.body,
    adjustments: directive.adjustments.map((adjustment) => ({
      name: adjustment.name,
      ...(adjustment.value === undefined ? {} : { value: adjustment.value }),
      range: adjustment.range,
    })),
    range: directive.range,
    nameRange: directive.nameRange,
  };
}

/** A frontmatter scalar reaches a rich-text slot as one run of text spanning its key. */
function scalarCandidate(name: string, value: string, range: SourceRange): Candidate {
  return {
    name,
    text: [{ kind: 'text', value, range }],
    adjustments: [],
    range,
    nameRange: range,
  };
}

class Resolver {
  private readonly problems: Diagnostic[] = [];
  private readonly slots = new Map<string, ResolvedSlot>();
  private readonly artworks: ResolvedArtwork[] = [];
  private readonly assets = new Map<string, AssetRef>();

  constructor(
    private readonly manifest: TemplateManifest,
    private readonly options: ResolveOptions,
  ) {}

  report(problem: Diagnostic): void {
    this.problems.push(problem);
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.problems;
  }

  /**
   * Turns one thing the brief said into a slot value, or into the reason it is not one.
   *
   * Both halves of a brief land here: a `::directive` and a frontmatter key differ in
   * where they came from and in nothing else by the time the manifest is asked.
   */
  async take(candidate: Candidate, fromFrontmatter: boolean): Promise<void> {
    const slot = this.manifest.slots[candidate.name];
    if (slot === undefined) {
      this.report(unknownSlot(candidate.name, this.manifest, candidate.nameRange));
      return;
    }

    if (slot.repeat && fromFrontmatter) {
      this.report(
        badValue(
          candidate.name,
          'a repeatable slot is set with a ::directive, not in the frontmatter',
          candidate.range,
        ),
      );
      return;
    }

    const adjustments = this.checkAdjustments(candidate, slot);
    const value = await this.valueOf(candidate, slot, fromFrontmatter);
    if (value === undefined) return;

    const resolved: ResolvedSlot = {
      name: candidate.name,
      value,
      adjustments,
      range: candidate.range,
    };

    if (slot.repeat) {
      this.artworks.push({ index: this.artworks.length, slot: resolved });
      return;
    }

    if (this.slots.has(candidate.name)) {
      this.report(
        badValue(
          candidate.name,
          'is set more than once, and only a repeatable slot may be',
          candidate.range,
        ),
      );
      return;
    }
    this.slots.set(candidate.name, resolved);
  }

  private checkAdjustments(candidate: Candidate, slot: Slot): readonly ResolvedAdjustment[] {
    const kept: ResolvedAdjustment[] = [];

    for (const adjustment of candidate.adjustments) {
      const declared = this.manifest.adjustments[adjustment.name];
      if (declared === undefined || !declared.applies.includes(candidate.name)) {
        const usable = Object.entries(this.manifest.adjustments)
          .filter(([, entry]) => entry.applies.includes(candidate.name))
          .map(([name]) => name);
        this.report(
          diagnostic(
            'E_BAD_ADJUSTMENT',
            {
              adjustment: adjustment.name,
              slot: candidate.name,
              declared: usable.length === 0 ? 'none' : usable.join(', '),
            },
            { range: adjustment.range },
          ),
        );
        continue;
      }

      if (declared.type === 'enum') {
        const value = adjustment.value ?? declared.default;
        if (value === undefined) {
          this.report(
            badValue(
              candidate.name,
              `adjustment '${adjustment.name}' needs a value, as in {${adjustment.name}: ${declared.values?.[0] ?? 'x'}}`,
              adjustment.range,
            ),
          );
          continue;
        }
        if (declared.values !== undefined && !declared.values.includes(value)) {
          this.report(
            badValue(
              candidate.name,
              `adjustment '${adjustment.name}' does not accept '${value}'; it accepts ${declared.values.join(', ')}`,
              adjustment.range,
            ),
          );
          continue;
        }
      } else if (adjustment.value !== undefined) {
        this.report(
          badValue(
            candidate.name,
            `adjustment '${adjustment.name}' is a flag and takes no value`,
            adjustment.range,
          ),
        );
        continue;
      }

      kept.push(adjustment);
    }

    // `slot` is read for its side of the contract only; the manifest already checked that
    // every `applies` entry names a declared slot, so nothing here re-derives that.
    void slot;
    return kept;
  }

  private async valueOf(
    candidate: Candidate,
    slot: Slot,
    fromFrontmatter: boolean,
  ): Promise<SlotValue | undefined> {
    const plain = plainText(candidate.text).trim();

    switch (slot.type) {
      case 'rich-text': {
        const markup = fromFrontmatter ? markupIn(plain) : undefined;
        if (markup !== undefined) {
          this.report(
            diagnostic(
              'W_MARKUP_IN_FRONTMATTER',
              { slot: candidate.name, markup },
              { range: candidate.range },
            ),
          );
        }

        if (!slot.repeat && slot.max !== undefined && plain.length > slot.max) {
          this.report(
            badValue(
              candidate.name,
              `is ${plain.length} characters and the manifest allows ${slot.max}`,
              candidate.range,
            ),
          );
          return undefined;
        }
        return { kind: 'rich-text', text: candidate.text };
      }

      case 'enum': {
        if (slot.values !== undefined && !slot.values.includes(plain)) {
          this.report(
            badValue(
              candidate.name,
              `'${plain}' is not one of ${slot.values.join(', ')}`,
              candidate.range,
            ),
          );
          return undefined;
        }
        return { kind: 'enum', value: plain };
      }

      case 'image': {
        const asset = await this.options.assets.resolve(plain);
        if (asset === undefined) {
          this.report(
            diagnostic(
              'E_ASSET_NOT_FOUND',
              { path: plain, base: this.options.assets.base },
              { range: candidate.range },
            ),
          );
          return undefined;
        }
        this.assets.set(asset.id, asset);
        return { kind: 'image', asset };
      }

      default:
        return undefined;
    }
  }

  /** Manifest defaults, the required slots nobody set, and the repeat count. */
  finish(fallbackRange: SourceRange | undefined): void {
    for (const [name, slot] of Object.entries(this.manifest.slots)) {
      if (slot.default !== undefined && !this.slots.has(name) && !slot.repeat) {
        this.slots.set(name, {
          name,
          value: { kind: 'enum', value: slot.default },
          adjustments: [],
        });
        continue;
      }

      const set = slot.repeat ? this.artworks.length > 0 : this.slots.has(name);
      if (slot.required && !set) {
        this.report(
          diagnostic(
            'E_MISSING_REQUIRED_SLOT',
            { template: this.manifest.name, slot: name },
            fallbackRange === undefined ? {} : { range: fallbackRange },
          ),
        );
      }

      if (slot.repeat) {
        const count = this.artworks.length;
        if (slot.min !== undefined && count < slot.min) {
          // Too few occurrences has no occurrence to point at — zero of them is the
          // usual case — so it borrows the same fallback `E_MISSING_REQUIRED_SLOT`
          // uses. A span covering the frontmatter beats a diagnostic an editor cannot
          // place anywhere at all.
          this.report(
            badValue(
              name,
              `appears ${count} times and the manifest needs ${slot.min}`,
              fallbackRange,
            ),
          );
        }
        if (slot.max !== undefined && count > slot.max) {
          this.report(
            badValue(
              name,
              `appears ${count} times and the manifest allows ${slot.max}`,
              this.artworks[slot.max]?.slot.range,
            ),
          );
        }
      }
    }

    const rendered = this.options.renderedSlots;
    if (rendered !== undefined) {
      for (const [name, resolved] of this.slots) {
        if (rendered.includes(name)) continue;
        this.report(
          diagnostic(
            'W_UNUSED_SLOT',
            { slot: name, template: this.manifest.name },
            resolved.range === undefined ? {} : { range: resolved.range },
          ),
        );
      }
    }
  }

  build(formats: readonly string[]): ResolvedBrief {
    return {
      template: this.manifest.name,
      formats,
      slots: Object.fromEntries(this.slots),
      artworks: this.artworks,
      assets: [...this.assets.values()],
    };
  }
}

/**
 * The formats to render: the frontmatter's, else the caller's, else the manifest's own.
 *
 * The range goes on the diagnostic only when the frontmatter asked, because a `--formats`
 * flag has nowhere in the file for an editor to underline.
 */
function formatsOf(
  ast: BriefAst,
  manifest: TemplateManifest,
  override: readonly string[] | undefined,
  report: (problem: Diagnostic) => void,
): readonly string[] {
  const written = ast.frontmatter.data.formats;
  const requested =
    written ?? (override !== undefined && override.length > 0 ? override : undefined);
  if (requested === undefined) return manifest.formats;

  const range = written === undefined ? undefined : ast.frontmatter.ranges.formats;
  const listed = Array.isArray(requested) ? requested : [requested];
  const kept: string[] = [];

  for (const entry of listed) {
    const format = String(entry);
    if (manifest.formats.includes(format)) {
      kept.push(format);
      continue;
    }
    report(
      diagnostic(
        'E_UNKNOWN_FORMAT',
        { format, template: manifest.name, declared: manifest.formats.join(', ') },
        range === undefined ? {} : { range },
      ),
    );
  }

  return kept;
}

export async function resolve(
  ast: BriefAst,
  options: ResolveOptions,
): Promise<Result<ResolvedBrief, Diagnostics>> {
  const named = ast.frontmatter.data.template;
  const name = typeof named === 'string' && named.trim() !== '' ? named.trim() : options.template;

  // The two questions that have to be answered before any other one is worth asking:
  // without a manifest there is nothing to check a slot against.
  if (name === undefined || name === '') {
    const range = ast.frontmatter.range ?? ast.range;
    return err([diagnostic('E_NO_TEMPLATE', {}, { range })]);
  }

  const manifest = options.registry.get(name);
  if (manifest === undefined) {
    const available = options.registry.list().map((entry) => entry.name);
    const range = ast.frontmatter.ranges.template ?? ast.frontmatter.range ?? ast.range;
    return err([
      diagnostic(
        'E_UNKNOWN_TEMPLATE',
        { template: name, available: available.length === 0 ? 'none' : available.join(', ') },
        {
          range,
          ...(didYouMean(name, available) === undefined
            ? {}
            : { hint: `Did you mean '${didYouMean(name, available) ?? ''}'?` }),
        },
      ),
    ]);
  }

  const resolver = new Resolver(manifest, options);
  const formats = formatsOf(ast, manifest, options.formats, (problem) => {
    resolver.report(problem);
  });

  for (const [key, value] of Object.entries(ast.frontmatter.data)) {
    if (RESERVED.has(key)) continue;
    const range = ast.frontmatter.ranges[key] ?? ast.frontmatter.range ?? ast.range;
    await resolver.take(scalarCandidate(key, String(value), range), true);
  }

  for (const directive of ast.directives) {
    if (directive.namespace !== undefined) {
      // Namespaced directives come from plugins, and there is no plugin host yet (E7).
      resolver.report(
        diagnostic(
          'E_UNKNOWN_DIRECTIVE',
          { directive: `${directive.namespace}/${directive.name}` },
          { range: directive.nameRange },
        ),
      );
      continue;
    }
    await resolver.take(candidateOf(directive), false);
  }

  resolver.finish(ast.frontmatter.range ?? ast.range);

  return fromDiagnostics(resolver.build(formats), resolver.diagnostics);
}
