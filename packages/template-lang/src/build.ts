import type {
  AssetRef,
  BlendMode,
  Effect,
  Fit,
  Frame,
  Paint,
  RichText,
  RunStyle,
  Size,
  TemplateContext,
  TemplateManifest,
  TextAlign,
  TextOverflow,
  TextVerticalAlign,
} from '@tyto/core';
import { blendModes } from '@tyto/core';
import {
  TemplateError,
  font,
  frame,
  group,
  image,
  rect,
  runsOf,
  text,
  vector,
} from '@tyto/core/template';
import type { NodeDraft, NodeOptions, TextOptions } from '@tyto/core/template';

import type { StyleDeclaration, TemplateAttribute, TemplateElement, ValueToken } from './ast.js';
import {
  type FrameDefinition,
  attributeOf,
  classesOf,
  interpolatedSlots,
  wholeSlotReference,
} from './frames.js';
import { parseAttributeValue } from './parse-template.js';
import {
  type Conditions,
  type RuleEntry,
  classStyle,
  computeStyle,
  resolveVariables,
  variablesOf,
} from './style.js';
import {
  type LengthContext,
  type Report,
  readAnchor,
  readBoolean,
  readFont,
  readKeyword,
  readLength,
  readNumber,
  readPaint,
  readRadius,
  readShadow,
  readStroke,
} from './values.js';
import { badValue, markupProblem } from './vocabulary.js';

/**
 * One `(artwork, format)` call: markup plus stylesheet → a `Frame`.
 *
 * It goes through the same SDK a `template.ts` uses, deliberately. Both paths converge on
 * `Scene` (ADR 0005), and the cheapest way to keep them from drifting is for the markup
 * path to have no way of writing IR the code path could not — the builders fill in the
 * defaults, `frame()` assigns the ids, and `parseScene` validates whatever comes out.
 *
 * Two things are decided here that neither the markup nor the stylesheet says out loud. A
 * node whose slot the brief left unset is left out rather than drawn empty, which is what
 * makes `@if slot(x) is empty` worth writing. And an explicit `id="grad"` is namespaced
 * with `context.idPrefix`, because ids are unique across a whole scene and a literal
 * `grad` would collide with itself in every other artwork and format.
 */

/** What a build needs that the markup cannot carry: the files around the template. */
export interface TemplateAssets {
  /** The SVG markup of a `<vector src="…">`, by template-relative path. */
  svg?: (path: string) => string | undefined;
  /** The asset behind an `<image src="…">` that names a file rather than a slot. */
  image?: (path: string) => AssetRef | undefined;
}

export interface Program {
  readonly manifest: TemplateManifest;
  readonly frames: ReadonlyMap<string, FrameDefinition>;
  readonly entries: readonly RuleEntry[];
  readonly assets: TemplateAssets;
  readonly repeatable: string | undefined;
}

/** A template's own failure, carrying the diagnostic `compile` will surface (ADR 0014). */
function fail(field: string, problem: string): never {
  throw new TemplateError(field, problem);
}

/**
 * What the guards are asked, read off this call's context.
 *
 * An adjustment beats a slot of the same name: `cor` on the manifest is the artwork's
 * default and `{cor: laranja}` on this slide is the exception the brief wrote, so the
 * exception is what `@if slot(cor) is laranja` and `--slot-cor` see.
 */
export function conditionsOf(program: Program, context: TemplateContext): Conditions {
  const classes = new Set<string>();
  const values = new Map<string, string>();
  const emptySlots = new Set<string>();

  for (const name of Object.keys(program.manifest.slots)) {
    if (context.slots[name] === undefined) emptySlots.add(name);
  }

  for (const [name, slot] of Object.entries(context.slots)) {
    if (slot.value.kind === 'enum') values.set(name, slot.value.value);
  }

  for (const [name, value] of Object.entries(context.adjustments)) {
    if (value === true) classes.add(name);
    else values.set(name, value);
  }

  const repeatable =
    program.repeatable !== undefined && context.slots[program.repeatable] !== undefined
      ? program.repeatable
      : undefined;

  return { format: context.format, classes, values, emptySlots, repeatable };
}

interface Scope {
  readonly program: Program;
  readonly context: TemplateContext;
  readonly conditions: Conditions;
  readonly variables: ReadonlyMap<string, readonly ValueToken[]>;
  readonly lengths: LengthContext;
  readonly report: Report;
}

/** A declaration's tokens with `var()` already spliced in. */
function tokensOf(declaration: StyleDeclaration | undefined, scope: Scope): ValueToken[] {
  return declaration === undefined ? [] : resolveVariables(declaration.value, scope.variables);
}

type Computed = Map<string, StyleDeclaration>;

function has(computed: Computed, property: string): boolean {
  return computed.has(property);
}

function lengthOf(
  computed: Computed,
  property: string,
  axis: 'w' | 'h',
  scope: Scope,
): number | undefined {
  const declaration = computed.get(property);
  if (declaration === undefined) return undefined;
  return readLength(
    tokensOf(declaration, scope),
    axis,
    scope.lengths,
    property,
    declaration.valueRange,
    scope.report,
  );
}

function numberOf(computed: Computed, property: string, scope: Scope): number | undefined {
  const declaration = computed.get(property);
  if (declaration === undefined) return undefined;
  return readNumber(tokensOf(declaration, scope), property, declaration.valueRange, scope.report);
}

function keywordOf<Word extends string>(
  computed: Computed,
  property: string,
  allowed: readonly Word[],
  scope: Scope,
): Word | undefined {
  const declaration = computed.get(property);
  if (declaration === undefined) return undefined;
  return readKeyword(
    tokensOf(declaration, scope),
    allowed,
    property,
    declaration.valueRange,
    scope.report,
  );
}

function paintOf(computed: Computed, property: string, scope: Scope): Paint | undefined {
  const declaration = computed.get(property);
  if (declaration === undefined) return undefined;
  return readPaint(tokensOf(declaration, scope), property, declaration.valueRange, scope.report);
}

/** An attribute read as a value, for the handful the language keeps on the tag. */
function attributeTokens(
  attribute: TemplateAttribute | undefined,
  scope: Scope,
): ValueToken[] | undefined {
  if (attribute === undefined) return undefined;
  const parsed = parseAttributeValue(attribute.value, attribute.valueRange);
  if (parsed === undefined) {
    scope.report(
      badValue(attribute.name, `'${attribute.value}' is not a value`, attribute.valueRange),
    );
    return undefined;
  }
  return resolveVariables(parsed, scope.variables);
}

function effectsOf(computed: Computed, scope: Scope): Effect[] {
  const effects: Effect[] = [];

  const shadow = computed.get('shadow');
  if (shadow !== undefined) {
    const value = readShadow(tokensOf(shadow, scope), 'shadow', shadow.valueRange, scope.report);
    if (value !== undefined) effects.push({ kind: 'shadow', ...value });
  }

  const blur = computed.get('blur');
  if (blur !== undefined) {
    const radius = numberOf(computed, 'blur', scope);
    if (radius !== undefined) effects.push({ kind: 'blur', radius });
  }

  return effects;
}

/**
 * Everything a node carries whatever it draws.
 *
 * The attribute is the shorthand and the stylesheet is the override: `opacity="0.95"` on
 * the tag is what the node is unless a rule says otherwise, which is the order an author
 * reading top to bottom expects.
 */
function baseOptions(element: TemplateElement, computed: Computed, scope: Scope): NodeOptions {
  const own = attributeOf(element, 'id')?.value;
  const id = own === undefined || own === '' ? undefined : `${scope.context.idPrefix}.${own}`;
  const name = attributeOf(element, 'name')?.value;

  const x = lengthOf(computed, 'x', 'w', scope);
  const y = lengthOf(computed, 'y', 'h', scope);
  const rotation = numberOf(computed, 'rotation', scope);
  const anchorDeclaration = computed.get('anchor');
  const anchor =
    anchorDeclaration === undefined
      ? undefined
      : readAnchor(
          tokensOf(anchorDeclaration, scope),
          'anchor',
          anchorDeclaration.valueRange,
          scope.report,
        );

  const transform = {
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    ...(rotation === undefined ? {} : { rotation }),
    ...(anchor === undefined ? {} : { anchor }),
  };

  const attributeOpacity = attributeTokens(attributeOf(element, 'opacity'), scope);
  const opacity = has(computed, 'opacity')
    ? numberOf(computed, 'opacity', scope)
    : attributeOpacity === undefined
      ? undefined
      : readNumber(
          attributeOpacity,
          'opacity',
          attributeOf(element, 'opacity')?.valueRange ?? element.range,
          scope.report,
        );

  const blend = has(computed, 'mix-blend-mode')
    ? keywordOf(computed, 'mix-blend-mode', blendModes, scope)
    : blendOfAttribute(element, scope);

  const visible = visibilityOf(computed, scope);
  const mask = maskOf(element, scope);
  const clip = attributeOf(element, 'clip') === undefined ? undefined : true;
  const effects = effectsOf(computed, scope);

  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined || name === '' ? {} : { name }),
    ...(Object.keys(transform).length === 0 ? {} : { transform }),
    ...(opacity === undefined ? {} : { opacity }),
    ...(blend === undefined ? {} : { blend }),
    ...(visible === undefined ? {} : { visible }),
    ...(mask === undefined ? {} : { mask }),
    ...(clip === undefined ? {} : { clip }),
    ...(effects.length === 0 ? {} : { effects }),
  };
}

function blendOfAttribute(element: TemplateElement, scope: Scope): BlendMode | undefined {
  const attribute = attributeOf(element, 'blend');
  if (attribute === undefined) return undefined;
  if (!(blendModes as readonly string[]).includes(attribute.value)) {
    scope.report(
      badValue(
        'blend',
        `'${attribute.value}' is not one of ${blendModes.join(', ')}`,
        attribute.valueRange,
      ),
    );
    return undefined;
  }
  return attribute.value as BlendMode;
}

function visibilityOf(computed: Computed, scope: Scope): boolean | undefined {
  const declaration = computed.get('visible');
  if (declaration === undefined) return undefined;
  return readBoolean(tokensOf(declaration, scope), 'visible', declaration.valueRange, scope.report);
}

/** `mask="#grad"` names an id in this frame, and ids are namespaced by the prefix. */
function maskOf(element: TemplateElement, scope: Scope): NodeOptions['mask'] {
  const attribute = attributeOf(element, 'mask');
  if (attribute === undefined) return undefined;
  const reference = attribute.value.startsWith('#') ? attribute.value.slice(1) : attribute.value;
  return { nodeId: `${scope.context.idPrefix}.${reference}`, mode: 'alpha' };
}

function sizeOf(
  computed: Computed,
  scope: Scope,
  element: TemplateElement,
  what: string,
): Size | undefined {
  const w = lengthOf(computed, 'w', 'w', scope);
  const h = lengthOf(computed, 'h', 'h', scope);
  if (w === undefined || h === undefined) {
    fail(
      what,
      `<${element.tag}> needs a w and an h; this one has ${w === undefined ? 'no w' : 'no h'}`,
    );
  }
  return { w, h };
}

/** The run style a text draws in, before the brief's own emphasis is layered on. */
function runStyleOf(computed: Computed, scope: Scope): RunStyle {
  const fontDeclaration = computed.get('font');
  const shorthand =
    fontDeclaration === undefined
      ? undefined
      : readFont(
          tokensOf(fontDeclaration, scope),
          'font',
          fontDeclaration.valueRange,
          scope.report,
        );

  if (shorthand === undefined) {
    fail('font', 'a text needs a font, as in font: 700 72px/1.05 "Inter"');
  }

  const size = numberOf(computed, 'font-size', scope) ?? shorthand.size;
  const weight = numberOf(computed, 'font-weight', scope) ?? shorthand.weight ?? 400;
  const paint = paintOf(computed, 'color', scope);
  if (paint === undefined) fail('color', 'a text needs a color');

  return { font: font(shorthand.family), size, weight, color: paint };
}

/** A mark in the brief takes the run properties of the class that spells it out. */
function markStyleOf(scope: Scope, key: string, value: string): Partial<RunStyle> | undefined {
  const computed = classStyle(scope.program.entries, scope.conditions, `${key}-${value}`);
  if (computed.size === 0) return undefined;

  const size = numberOf(computed, 'font-size', scope);
  const weight = numberOf(computed, 'font-weight', scope);
  const paint = paintOf(computed, 'color', scope);
  const fontDeclaration = computed.get('font');
  const shorthand =
    fontDeclaration === undefined
      ? undefined
      : readFont(
          tokensOf(fontDeclaration, scope),
          'font',
          fontDeclaration.valueRange,
          scope.report,
        );

  return {
    ...(shorthand === undefined ? {} : { font: font(shorthand.family), size: shorthand.size }),
    ...(size === undefined ? {} : { size }),
    ...(weight === undefined ? {} : { weight }),
    ...(paint === undefined ? {} : { color: paint }),
  };
}

const ALIGNMENTS: readonly TextAlign[] = ['left', 'center', 'right', 'justify'];
const VERTICAL_ALIGNMENTS: readonly TextVerticalAlign[] = ['top', 'middle', 'bottom'];
const OVERFLOWS: readonly TextOverflow[] = ['clip', 'shrink', 'grow'];
const FITS: readonly Fit[] = ['cover', 'contain', 'fill'];

function textNode(
  element: TemplateElement,
  computed: Computed,
  scope: Scope,
): NodeDraft | undefined {
  const name = attributeOf(element, 'slot')?.value ?? '';
  const slot = scope.context.slots[name];
  if (slot === undefined || slot.value.kind !== 'rich-text') return undefined;

  const style = runStyleOf(computed, scope);
  const runs = runsOf(slot.value.text as RichText, style, {
    mark: (key, value) => markStyleOf(scope, key, value),
  });
  const first = runs[0];
  // Nothing to draw is not an error: a brief that set a slot to nothing but emphasis is a
  // brief with an empty slot, and `E_SCENE_EMPTY_TEXT` is for scenes built by hand.
  if (first === undefined || runs.every((item) => item.kind === 'break')) return undefined;

  const fontDeclaration = computed.get('font');
  const shorthandLineHeight =
    fontDeclaration === undefined
      ? undefined
      : readFont(tokensOf(fontDeclaration, scope), 'font', fontDeclaration.valueRange, () => {})
          ?.lineHeight;

  const w = lengthOf(computed, 'w', 'w', scope);
  const h = lengthOf(computed, 'h', 'h', scope);
  const lineHeight = numberOf(computed, 'line-height', scope) ?? shorthandLineHeight;
  const letterSpacing = numberOf(computed, 'letter-spacing', scope);
  const align = keywordOf(computed, 'text-align', ALIGNMENTS, scope);
  const valign = keywordOf(computed, 'vertical-align', VERTICAL_ALIGNMENTS, scope);
  const overflow = keywordOf(computed, 'overflow', OVERFLOWS, scope);

  const options: TextOptions = {
    ...baseOptions(element, computed, scope),
    runs: [first, ...runs.slice(1)],
    box: { ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) },
    ...(lineHeight === undefined ? {} : { lineHeight }),
    ...(letterSpacing === undefined ? {} : { letterSpacing }),
    ...(align === undefined ? {} : { align }),
    ...(valign === undefined ? {} : { valign }),
    ...(overflow === undefined ? {} : { overflow }),
  };

  return text(options);
}

/** `{imagem}` alone is the slot; anything else is a path, with enums spliced into it. */
function assetOf(element: TemplateElement, scope: Scope): AssetRef | undefined {
  const named = attributeOf(element, 'slot')?.value;
  if (named !== undefined) {
    const slot = scope.context.slots[named];
    return slot?.value.kind === 'image' ? slot.value.asset : undefined;
  }

  const source = attributeOf(element, 'src');
  if (source === undefined) return undefined;

  const whole = wholeSlotReference(source.value);
  if (whole !== undefined) {
    const slot = scope.context.slots[whole];
    if (slot?.value.kind === 'image') return slot.value.asset;
    if (slot === undefined) return undefined;
  }

  const path = interpolate(source.value, scope);
  if (path === undefined) return undefined;
  const found = scope.program.assets.image?.(path);
  if (found === undefined) {
    fail('src', `no image asset at '${path}'`);
  }
  return found;
}

/** `assets/{cor}.png` with the enum's word in it; an unset slot leaves the node out. */
function interpolate(value: string, scope: Scope): string | undefined {
  let missing = false;
  const filled = value.replaceAll(/\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/gu, (_whole, name: string) => {
    const slot = scope.context.slots[name];
    if (slot?.value.kind === 'enum') return slot.value.value;
    if (slot?.value.kind === 'rich-text') return plainTextOf(slot.value.text as RichText);
    missing = true;
    return '';
  });
  return missing ? undefined : filled;
}

function plainTextOf(value: RichText): string {
  return value
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
          return inline.value;
        case 'break':
          return '';
        default:
          return plainTextOf(inline.children);
      }
    })
    .join('');
}

function imageNode(
  element: TemplateElement,
  computed: Computed,
  scope: Scope,
): NodeDraft | undefined {
  const asset = assetOf(element, scope);
  if (asset === undefined) return undefined;

  const size = sizeOf(computed, scope, element, 'image');
  if (size === undefined) return undefined;

  const attribute = attributeOf(element, 'fit');
  const fit =
    attribute === undefined
      ? undefined
      : (FITS as readonly string[]).includes(attribute.value)
        ? (attribute.value as Fit)
        : (scope.report(
            badValue(
              'fit',
              `'${attribute.value}' is not one of ${FITS.join(', ')}`,
              attribute.valueRange,
            ),
          ),
          undefined);

  return image({
    ...baseOptions(element, computed, scope),
    asset,
    size,
    ...(fit === undefined ? {} : { fit }),
  });
}

function vectorNode(
  element: TemplateElement,
  computed: Computed,
  scope: Scope,
): NodeDraft | undefined {
  const source = attributeOf(element, 'src');
  const path = source === undefined ? undefined : interpolate(source.value, scope);
  if (path === undefined) return undefined;

  const markup = scope.program.assets.svg?.(path);
  if (markup === undefined) fail('src', `no SVG file at '${path}'`);

  const size = sizeOf(computed, scope, element, 'vector');
  if (size === undefined) return undefined;

  const fill = paintOf(computed, 'fill', scope);
  const strokeDeclaration = computed.get('stroke');
  const stroke =
    strokeDeclaration === undefined
      ? undefined
      : readStroke(
          tokensOf(strokeDeclaration, scope),
          'stroke',
          strokeDeclaration.valueRange,
          scope.report,
        );

  return vector({
    ...baseOptions(element, computed, scope),
    geometry: { kind: 'svg', markup },
    size,
    ...(fill === undefined ? {} : { fill }),
    ...(stroke === undefined ? {} : { stroke }),
  });
}

function rectNode(element: TemplateElement, computed: Computed, scope: Scope): NodeDraft {
  const size = sizeOf(computed, scope, element, 'rect') ?? { w: 0, h: 0 };
  const fill = paintOf(computed, 'fill', scope);
  const radiusDeclaration = computed.get('radius');
  const radius =
    radiusDeclaration === undefined
      ? undefined
      : readRadius(
          tokensOf(radiusDeclaration, scope),
          'radius',
          radiusDeclaration.valueRange,
          scope.report,
        );
  const strokeDeclaration = computed.get('stroke');
  const stroke =
    strokeDeclaration === undefined
      ? undefined
      : readStroke(
          tokensOf(strokeDeclaration, scope),
          'stroke',
          strokeDeclaration.valueRange,
          scope.report,
        );

  return rect({
    ...baseOptions(element, computed, scope),
    size,
    ...(fill === undefined ? {} : { fill }),
    ...(radius === undefined ? {} : { radius }),
    ...(stroke === undefined ? {} : { stroke }),
  });
}

/**
 * A group that declares a size becomes the box its children's percentages are of.
 *
 * The IR gives a group no size — it is a transform and a list — so the number is used and
 * not stored. That is the whole reason `%` is documented as "of the nearest ancestor that
 * declared one, and the frame otherwise": there is nothing else for it to be of.
 */
function groupNode(element: TemplateElement, computed: Computed, scope: Scope): NodeDraft {
  const w = lengthOf(computed, 'w', 'w', scope);
  const h = lengthOf(computed, 'h', 'h', scope);
  const inner: Scope =
    w === undefined && h === undefined
      ? scope
      : {
          ...scope,
          lengths: {
            frame: scope.lengths.frame,
            parent: { w: w ?? scope.lengths.parent.w, h: h ?? scope.lengths.parent.h },
          },
        };

  return group({
    ...baseOptions(element, computed, scope),
    children: buildChildren(element.children, inner),
  });
}

function buildNode(element: TemplateElement, scope: Scope): NodeDraft | undefined {
  const computed = computeStyle(scope.program.entries, scope.conditions, {
    tag: element.tag,
    id: attributeOf(element, 'id')?.value,
    classes: classesOf(element),
  });

  switch (element.tag) {
    case 'group':
      return groupNode(element, computed, scope);
    case 'rect':
      return rectNode(element, computed, scope);
    case 'text':
      return textNode(element, computed, scope);
    case 'image':
      return imageNode(element, computed, scope);
    case 'vector':
      return vectorNode(element, computed, scope);
    default:
      // Unreachable: `collectFrames` refused every other tag before a build could start.
      return undefined;
  }
}

function buildChildren(elements: readonly TemplateElement[], scope: Scope): NodeDraft[] {
  const drafts: NodeDraft[] = [];
  for (const element of elements) {
    const draft = buildNode(element, scope);
    if (draft !== undefined) drafts.push(draft);
  }
  return drafts;
}

function backgroundOf(definition: FrameDefinition, scope: Scope): Paint | undefined {
  if (definition.bg === undefined) return undefined;
  if (definition.bg.value.trim() === 'none') return undefined;

  const tokens = attributeTokens(definition.bg, scope);
  if (tokens === undefined || tokens.length === 0) return undefined;
  return readPaint(tokens, 'bg', definition.bg.valueRange, scope.report);
}

/**
 * The build function `defineTemplate` pairs with the manifest.
 *
 * Whatever it reports through `Report` at this point is a value the stylesheet could not
 * turn into IR, and there is no `Result` to put it on — a `TemplateBuild` returns a frame.
 * So the first one becomes a `TemplateError`, which is exactly the channel ADR 0014 gives
 * a template for saying it cannot build: `compile` catches it and surfaces the diagnostic
 * it already carries.
 */
export function buildFrame(program: Program, context: TemplateContext): Frame {
  const definition = program.frames.get(context.format);
  if (definition === undefined) {
    fail('format', `no frame declares format '${context.format}'`);
  }

  const conditions = conditionsOf(program, context);
  const problems: { field: string; problem: string }[] = [];
  const scope: Scope = {
    program,
    context,
    conditions,
    variables: variablesOf(program.entries, conditions),
    lengths: { frame: context.size, parent: context.size },
    report: (item) => {
      problems.push({ field: item.code, problem: item.message });
    },
  };

  const children = buildChildren(definition.children, scope);
  const background = backgroundOf(definition, scope);

  const first = problems[0];
  if (first !== undefined) throw new TemplateError('template.html', first.problem);

  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    children,
    ...(background === undefined ? {} : { background }),
  });
}

/**
 * The same walk with no brief behind it, for `tyto template check`.
 *
 * A template is checked before anyone writes a brief for it, so the questions that do not
 * need one have to be asked here: whether every text has a font, whether every box has a
 * size, whether every value in the stylesheet parses. It runs once per format with every
 * condition off, which is the layout an author sees first and the one a missing `font`
 * hides in.
 */
export function checkStatically(program: Program, report: Report): void {
  for (const [format, definition] of program.frames) {
    const conditions: Conditions = {
      format,
      classes: new Set(),
      values: new Map(),
      emptySlots: new Set(Object.keys(program.manifest.slots)),
      repeatable: program.repeatable,
    };
    const scope: Scope = {
      program,
      context: staticContext(format),
      conditions,
      variables: variablesOf(program.entries, conditions),
      lengths: { frame: { w: 0, h: 0 }, parent: { w: 0, h: 0 } },
      report,
    };
    checkElements(definition.children, scope, report);
    if (definition.bg !== undefined && definition.bg.value.trim() !== 'none') {
      const tokens = attributeTokens(definition.bg, scope);
      if (tokens !== undefined) readPaint(tokens, 'bg', definition.bg.valueRange, report);
    }
  }
}

/**
 * Every declaration that reaches an element, read for its own sake.
 *
 * The build reads a property only when the node it is building has somewhere to put it —
 * a `w` on a `<text>` becomes a box, a `w` on a `<group>` becomes a percentage base and
 * nothing else. `tyto template check` cannot afford that: a unit nobody read is a unit
 * nobody refused, and the author finds out when a brief arrives. So this reads all of
 * them and throws the values away; the reporting is the point.
 */
function readEveryProperty(computed: Computed, scope: Scope): void {
  for (const property of computed.keys()) {
    switch (property) {
      case 'x':
      case 'w':
        lengthOf(computed, property, 'w', scope);
        break;
      case 'y':
      case 'h':
        lengthOf(computed, property, 'h', scope);
        break;
      case 'rotation':
      case 'opacity':
      case 'font-size':
      case 'font-weight':
      case 'line-height':
      case 'letter-spacing':
      case 'blur':
        numberOf(computed, property, scope);
        break;
      case 'anchor':
      case 'font':
      case 'stroke':
      case 'radius':
      case 'shadow':
      case 'visible':
        readCompound(computed, property, scope);
        break;
      case 'color':
      case 'fill':
        paintOf(computed, property, scope);
        break;
      case 'mix-blend-mode':
        keywordOf(computed, property, blendModes, scope);
        break;
      case 'text-align':
        keywordOf(computed, property, ALIGNMENTS, scope);
        break;
      case 'vertical-align':
        keywordOf(computed, property, VERTICAL_ALIGNMENTS, scope);
        break;
      case 'overflow':
        keywordOf(computed, property, OVERFLOWS, scope);
        break;
      default:
        break;
    }
  }
}

function readCompound(computed: Computed, property: string, scope: Scope): void {
  const declaration = computed.get(property);
  if (declaration === undefined) return;
  const tokens = tokensOf(declaration, scope);
  const at = declaration.valueRange;

  switch (property) {
    case 'anchor':
      readAnchor(tokens, property, at, scope.report);
      break;
    case 'font':
      readFont(tokens, property, at, scope.report);
      break;
    case 'stroke':
      readStroke(tokens, property, at, scope.report);
      break;
    case 'radius':
      readRadius(tokens, property, at, scope.report);
      break;
    case 'shadow':
      readShadow(tokens, property, at, scope.report);
      break;
    case 'visible':
      readBoolean(tokens, property, at, scope.report);
      break;
    default:
      break;
  }
}

function checkElements(elements: readonly TemplateElement[], scope: Scope, report: Report): void {
  for (const element of elements) {
    const computed = computeStyle(scope.program.entries, scope.conditions, {
      tag: element.tag,
      id: attributeOf(element, 'id')?.value,
      classes: classesOf(element),
    });

    readEveryProperty(computed, scope);
    attributeTokens(attributeOf(element, 'opacity'), scope);

    if (element.tag === 'text') {
      if (!has(computed, 'font')) {
        report(
          markupProblem(
            'this <text> is reached by no font declaration, and a run needs one',
            element.tagRange,
          ),
        );
      }
      if (!has(computed, 'color')) {
        report(markupProblem('this <text> is reached by no color declaration', element.tagRange));
      }
    }
    if (
      ['rect', 'image', 'vector'].includes(element.tag) &&
      !(has(computed, 'w') && has(computed, 'h'))
    ) {
      report(
        markupProblem(
          `this <${element.tag}> is reached by no w and h, and a box needs both`,
          element.tagRange,
        ),
      );
    }
    if (element.tag === 'vector') {
      const source = attributeOf(element, 'src');
      const literal = source !== undefined && interpolatedSlots(source.value).length === 0;
      if (literal && scope.program.assets.svg?.(source.value) === undefined) {
        report(markupProblem(`no SVG file at '${source.value}'`, source.valueRange));
      }
    }

    checkElements(element.children, scope, report);
  }
}

/** A context with nothing in it: the static check asks about layout, not about values. */
function staticContext(format: string): TemplateContext {
  return {
    format,
    size: { w: 0, h: 0 },
    idPrefix: format,
    artwork: { id: format, index: 0, count: 1 },
    slots: {},
    adjustments: {},
  };
}
