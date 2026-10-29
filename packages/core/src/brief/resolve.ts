import type { BriefAst, Directive, RichText } from './ast.js';
import { type DirectiveResolver, stampExpansion } from './directives.js';
import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import { didYouMean } from '../diagnostics/suggest.js';
import type { AssetResolver } from '../ports/asset-resolver.js';
import { type Diagnostics, type Result, err, fromPartial } from '../result/result.js';
import type { AssetRef } from '../scene/primitives.js';
import type { SourceRange } from '../source/range.js';
import type { TemplateConfigurations } from '../template/configurations.js';
import { type BriefDefaults, measured } from '../template/configured-brief.js';
import type { SuppliedValues } from '../template/declared-values.js';
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
 *
 * **And it hands back what it did resolve.** A slot the manifest refuses is one slot: the
 * value never enters `slots`, the diagnostic rides along on the ok branch, and the other
 * nineteen directives are still there to be compiled (ADR 0025). The two exceptions above
 * are exactly the fatal ones. `E_MISSING_REQUIRED_SLOT` was a third until ADR 0035 — an
 * artwork with a hole where the manifest promised content looks finished — and what makes
 * it non-fatal now is that the hole is drawn: the names go out in `missingRequiredSlots`
 * and `compile` stamps every frame built from them.
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
  /**
   * The required slots the brief left unset, in manifest order.
   *
   * The same thing `E_MISSING_REQUIRED_SLOT` reports, carried as *value* rather than only
   * as a diagnostic, because `compile` has to draw something for it (ADR 0035) and a stage
   * reads its predecessor's value, not its predecessor's problems. Empty is the normal
   * case and means the artwork is whole.
   */
  readonly missingRequiredSlots: readonly string[];
  /**
   * The configuration a plugin file gave the name the brief wrote (ADR 0151): an alias's, or
   * the entry's `default` for the template's own name. Absent when no file configures it.
   */
  readonly configuration?: string;
  /** That configuration's values, checked already, for `compile` (ADR 0153). */
  readonly values?: SuppliedValues;
}

export interface ResolveOptions {
  readonly registry: TemplateRegistry;
  readonly assets: AssetResolver;
  /** `--template` on the CLI, for a brief whose frontmatter names none. */
  readonly template?: string;
  /**
   * `--formats` on the CLI, or the Export dialog's ticks: the formats this run wants.
   *
   * Not `template`'s rule, on purpose (ADR 0107). A template is one choice, so a flag can
   * only stand in for a brief that made none. A brief's `formats` is a set, and a run may
   * want part of it: with a list in the frontmatter, these narrow it — the brief's formats
   * that are also named here, in the brief's order. A format named here that the template
   * renders but the brief does not list is `E_FORMAT_NOT_IN_BRIEF`, so a run never widens
   * what the brief asked for. With no list in the frontmatter these are used as they are.
   * Each entry is checked against the manifest the way the frontmatter's are, so a format
   * the template does not render is `E_UNKNOWN_FORMAT` whichever of the two named it.
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
  /**
   * What answers a `::namespace/name` directive: the plugins' directives, when the caller
   * activated any. Absent, every namespaced directive is `E_UNKNOWN_DIRECTIVE`.
   */
  readonly directives?: DirectiveResolver;
  /**
   * The plugin files' configurations and aliases (TYTO-439). A name the brief writes is
   * looked up here first, so an alias renders its template with its configuration's values.
   * Absent, every name is a template's own.
   */
  readonly configurations?: TemplateConfigurations;
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
  private readonly missingRequired: string[] = [];

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

        // Both ends, and both errors. `min` and `max` are one documented pair counting
        // characters here and occurrences on a repeatable slot, and the repeatable branch
        // in `finish()` already reports both ends with `E_BAD_SLOT_VALUE`. Leaving this
        // one end unenforced was a rule the manifest accepted and nothing applied
        // (TYTO-67); making it a warning instead would have given one pair three
        // behaviours across two slot kinds.
        if (!slot.repeat && slot.min !== undefined && plain.length < slot.min) {
          this.report(
            badValue(
              candidate.name,
              `is ${plain.length} characters and the manifest needs ${slot.min}`,
              candidate.range,
            ),
          );
          return undefined;
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
          const explained = this.options.assets.explain?.(plain);
          this.report(
            explained === undefined
              ? diagnostic(
                  'E_ASSET_NOT_FOUND',
                  { path: plain, searched: searchedIn(this.options.assets) },
                  { range: candidate.range },
                )
              : candidate.range === undefined
                ? explained
                : { ...explained, range: candidate.range },
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

  /**
   * A configuration's editor rules, tighter than the manifest's (TYTO-440). Past one is a
   * warning and the value stays: the manifest's `max` is the limit the template was drawn
   * for, and it already refused anything past that.
   */
  checkConfiguredLimits(brief: BriefDefaults, configuration: string): void {
    for (const [name, limit] of Object.entries(brief.editor)) {
      const slot = this.manifest.slots[name];
      if (slot === undefined) continue;
      let count: number;
      let range: SourceRange | undefined;
      if (slot.repeat) {
        const occurrences = this.artworks.filter((artwork) => artwork.slot.name === name);
        count = occurrences.length;
        range = occurrences[limit.max]?.slot.range;
      } else {
        const resolved = this.slots.get(name);
        if (resolved?.value.kind !== 'rich-text') continue;
        count = plainText(resolved.value.text).trim().length;
        range = resolved.range;
      }
      if (count <= limit.max) continue;
      this.report(
        diagnostic(
          'W_SLOT_OVER_CONFIGURED_LIMIT',
          {
            slot: name,
            measured: measured(slot, count),
            template: this.manifest.name,
            configuration,
            max: limit.max,
          },
          range === undefined ? {} : { range },
        ),
      );
    }
  }

  /** A configuration's slot defaults, for the slots the brief left unset: the brief wins. */
  fillDefaults(brief: BriefDefaults): void {
    for (const [name, value] of Object.entries(brief.slots)) {
      if (this.slots.has(name) || this.manifest.slots[name] === undefined) continue;
      if (value.kind === 'image') this.assets.set(value.asset.id, value.asset);
      this.slots.set(name, { name, value, adjustments: [] });
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
        this.missingRequired.push(name);
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
      missingRequiredSlots: this.missingRequired,
    };
  }
}

/**
 * The formats a brief's frontmatter lists, as strings; `undefined` when it has no
 * `formats` key.
 *
 * YAML lets an author write `formats: story` for a list of one, so a scalar becomes a
 * list of one here. Exported because the desktop renderer offers the brief's formats in
 * its Export dialog, and reading the line twice two ways is how the two would drift.
 */
export function listedFormats(data: Readonly<Record<string, unknown>>): string[] | undefined {
  const written = data.formats;
  if (written === undefined || written === null) return undefined;
  return (Array.isArray(written) ? written : [written]).map((entry) => String(entry));
}

/**
 * The formats to render: the frontmatter's, narrowed by the caller's when both list some;
 * else the caller's; else the configuration's (TYTO-440); else the manifest's own (ADR 0107).
 *
 * The range goes on a diagnostic only when the frontmatter is involved, because a
 * `--formats` flag has nowhere in the file for an editor to underline.
 */
function formatsOf(
  ast: BriefAst,
  manifest: TemplateManifest,
  override: readonly string[] | undefined,
  configured: readonly string[] | undefined,
  report: (problem: Diagnostic) => void,
): readonly string[] {
  const written = listedFormats(ast.frontmatter.data);
  const requested = override !== undefined && override.length > 0 ? override : undefined;
  const range = ast.frontmatter.ranges.formats;
  const unknown = (format: string, at: SourceRange | undefined): void => {
    report(
      diagnostic(
        'E_UNKNOWN_FORMAT',
        { format, template: manifest.name, declared: manifest.formats.join(', ') },
        at === undefined ? {} : { range: at },
      ),
    );
  };
  const rendered = (formats: readonly string[], at: SourceRange | undefined): string[] =>
    formats.filter((format) => {
      if (manifest.formats.includes(format)) return true;
      unknown(format, at);
      return false;
    });

  if (written === undefined) {
    return requested === undefined
      ? (configured ?? manifest.formats)
      : rendered(requested, undefined);
  }

  const listed = rendered(written, range);
  if (requested === undefined) return listed;

  for (const format of rendered(requested, undefined)) {
    if (listed.includes(format)) continue;
    report(
      diagnostic(
        'E_FORMAT_NOT_IN_BRIEF',
        { format, listed: listed.length === 0 ? 'none' : listed.join(', ') },
        range === undefined ? {} : { range },
      ),
    );
  }
  return listed.filter((format) => requested.includes(format));
}

/**
 * A plugin directive, as the slot directives it stands for (ADR 0043).
 *
 * Every diagnostic the plugin raises without a position is given the directive's, so a
 * plugin that timed out or crashed is still underlined where the author wrote it. The
 * replacements are stamped the same way, and `resolve` checks them as it checks anything
 * typed: a slot the manifest lacks is `E_UNKNOWN_SLOT` on the plugin directive's name.
 */
async function expand(
  directive: Directive,
  namespace: string,
  options: ResolveOptions,
  resolver: Resolver,
): Promise<readonly Directive[]> {
  const expander = options.directives?.find(namespace, directive.name);
  if (expander === undefined) {
    resolver.report(
      diagnostic(
        'E_UNKNOWN_DIRECTIVE',
        { directive: `${namespace}/${directive.name}` },
        { range: directive.nameRange },
      ),
    );
    return [];
  }

  const answer = await expander(directive);
  const problems = answer.ok ? answer.diagnostics : answer.error;
  for (const problem of problems) {
    resolver.report(problem.range === undefined ? { ...problem, range: directive.range } : problem);
  }
  return answer.ok ? answer.value.map((expanded) => stampExpansion(expanded, directive)) : [];
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

  const selection = options.configurations?.select(name);
  const manifest = options.registry.get(selection?.template ?? name);
  if (manifest === undefined) {
    const available = [
      ...options.registry.list().map((entry) => entry.name),
      ...(options.configurations?.aliases().map((entry) => entry.alias) ?? []),
    ].sort((left, right) => left.localeCompare(right));
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
  const briefSide = selection?.brief;
  const formats = formatsOf(ast, manifest, options.formats, briefSide?.formats, (problem) => {
    resolver.report(problem);
  });

  for (const [key, value] of Object.entries(ast.frontmatter.data)) {
    if (RESERVED.has(key)) continue;
    const range = ast.frontmatter.ranges[key] ?? ast.frontmatter.range ?? ast.range;
    await resolver.take(scalarCandidate(key, String(value), range), true);
  }

  for (const directive of ast.directives) {
    if (directive.namespace !== undefined) {
      for (const replacement of await expand(directive, directive.namespace, options, resolver)) {
        await resolver.take(candidateOf(replacement), false);
      }
      continue;
    }
    await resolver.take(candidateOf(directive), false);
  }

  if (briefSide !== undefined && selection?.configuration !== undefined) {
    // The limits read what the brief wrote, so they run before the defaults fill the rest.
    resolver.checkConfiguredLimits(briefSide, selection.configuration);
    resolver.fillDefaults(briefSide);
  }
  resolver.finish(ast.frontmatter.range ?? ast.range);

  const built = resolver.build(formats);
  return fromPartial(
    selection?.configuration === undefined
      ? built
      : { ...built, configuration: selection.configuration, values: selection.values },
    resolver.diagnostics,
  );
}

/**
 * The folders a resolver looked in, as `E_ASSET_NOT_FOUND` prints them: `'a'`, `'a' or 'b'`,
 * `'a', 'b' or 'c'`.
 */
function searchedIn(assets: AssetResolver): string {
  const folders = (assets.searched ?? [assets.base]).map((folder) => `'${folder}'`);
  if (folders.length <= 1) return folders.join('');
  return `${folders.slice(0, -1).join(', ')} or ${folders[folders.length - 1]}`;
}
