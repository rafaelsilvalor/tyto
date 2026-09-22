/**
 * The diagnostic catalog.
 *
 * Every error and warning Tyto can report is declared here once, with the message
 * template it renders from. Nothing else in the codebase may invent a message: a stage
 * names a code and supplies its parameters, which is what makes `docs/diagnostic-codes.md`
 * generatable and what will let the editor localise by code later.
 *
 * Adding a code means adding an entry here and regenerating the doc with `pnpm docs:gen`.
 */

export type DiagnosticSeverity = 'error' | 'warning';

export interface DiagnosticCodeDefinition {
  readonly severity: DiagnosticSeverity;
  /** One sentence on when this fires, for the generated doc. */
  readonly summary: string;
  /** Message with `{name}` placeholders; the names become the required parameters. */
  readonly template: string;
  /** The doc that defines the rule, so a reader can find the reasoning. */
  readonly spec: string;
  /**
   * Whether a stage that meets this has to give up its value entirely (ADR 0025).
   *
   * **Severity says how bad it is for the author; fatality says whether a value survives.**
   * They were one field until this card, and that conflation is why a stray character in
   * one directive used to blank a whole preview. A non-fatal error rides the ok branch
   * beside the partial value it did not prevent — it is still an error, so it still fails
   * a build, and `hasErrors` is what the CLI's exit code and `result.json`'s `status` read.
   *
   * Fatal means **nothing can be drawn**, not "serious". The test is whether a frame could
   * exist without the thing that is missing.
   */
  readonly fatal: boolean;
  /** Why it is or is not fatal, in one sentence, for the generated doc. */
  readonly fatality: string;
}

export const diagnosticCodes = {
  // Three syntax codes and not one, because fatality is a property of the code and one
  // code cannot be fatal in one place and not in another (ADR 0025). A broken line in the
  // body costs that directive; a frontmatter that does not parse costs the template
  // binding, which is everything; a template that does not parse costs every artwork drawn
  // through it.
  E_SYNTAX: {
    severity: 'error',
    summary: 'A line of the brief body does not match the grammar.',
    template: 'Syntax error: {problem}.',
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'One directive is unreadable and the parser already recovered the others.',
  },
  E_FRONTMATTER_SYNTAX: {
    severity: 'error',
    summary: "A brief's frontmatter is not valid YAML, or is not a mapping.",
    template: 'Frontmatter error: {problem}.',
    spec: 'docs/brief-language.md',
    fatal: true,
    fatality:
      'The frontmatter is where the template is named, so one that does not parse leaves ' +
      'nothing to render against.',
  },
  E_NO_TEMPLATE: {
    severity: 'error',
    summary: 'A brief names no template and none was supplied on the command line.',
    template: "The brief sets no 'template' in its frontmatter, and none was given.",
    spec: 'docs/brief-language.md',
    fatal: true,
    fatality: 'There is no template to render against, so no frame can exist.',
  },
  E_UNKNOWN_TEMPLATE: {
    severity: 'error',
    summary: 'A brief names a template the registry does not have.',
    template: "No template named '{template}'. Available: {available}.",
    spec: 'docs/brief-language.md',
    fatal: true,
    fatality: 'The same, one step later: a name the registry cannot answer is no template at all.',
  },
  E_UNKNOWN_FORMAT: {
    severity: 'error',
    summary: 'A requested format is not one the chosen template renders.',
    template: "Format '{format}' is not rendered by template '{template}'. It renders: {declared}.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'The formats the template does render are unaffected.',
  },
  E_BAD_SLOT_VALUE: {
    severity: 'error',
    summary: 'A slot is set to something the manifest does not allow for it.',
    template: "Slot '{slot}' is invalid: {problem}.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'The value of one slot; it stays unset and the rest of the artwork is drawn anyway.',
  },
  E_UNKNOWN_SLOT: {
    severity: 'error',
    summary: 'A directive names a slot the template manifest does not declare.',
    template: "Unknown slot '{slot}'. Template '{template}' declares: {declared}.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'The slot does not exist, and the ones that do are unaffected.',
  },
  E_UNKNOWN_DIRECTIVE: {
    severity: 'error',
    summary: 'A directive matches no template slot and no installed plugin.',
    template:
      "Unknown directive '::{directive}'. No template slot or installed plugin provides it.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'The same: a directive nothing claims contributes nothing to skip.',
  },
  E_MISSING_REQUIRED_SLOT: {
    severity: 'error',
    summary: 'The manifest marks a slot as required and the brief leaves it unset.',
    template: "Template '{template}' requires slot '{slot}', which the brief does not set.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality:
      'The artwork renders with a hole, and since ADR 0035 the hole is drawn: `compile` ' +
      'stamps every frame built from a brief that left a required slot unset, so the gap ' +
      'is in the exported bytes and not only in the problems panel.',
  },
  E_BAD_ADJUSTMENT: {
    severity: 'error',
    summary: 'An adjustment is not declared for the slot it is applied to.',
    template: "Adjustment '{adjustment}' is not declared for slot '{slot}'. Declared: {declared}.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'One adjustment on one slot; the slot keeps the adjustments that are declared.',
  },
  E_ASSET_NOT_FOUND: {
    severity: 'error',
    summary: 'An asset path in the brief does not resolve to a file.',
    template: "Asset '{path}' was not found relative to the brief at '{base}'.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality:
      'One image the brief named. The slot stays unset, so the scene never references bytes nobody can supply.',
  },
  E_UNSUPPORTED_CSS: {
    severity: 'error',
    summary: 'A template uses a CSS property outside the accepted set.',
    template:
      "CSS property '{property}' is not supported by the template language. Try '{suggestion}'.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The template is what every artwork is drawn through, so a broken one breaks all of them rather than one slot.',
  },
  E_UNSUPPORTED_TAG: {
    severity: 'error',
    summary: 'A template uses a tag the template language does not define.',
    template: "Tag '<{tag}>' is not part of the template language. Try '{suggestion}'.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The template is what every artwork is drawn through, so a broken one breaks all of them rather than one slot.',
  },
  E_UNSUPPORTED_ATTRIBUTE: {
    severity: 'error',
    summary: 'A template uses an attribute the tag it sits on does not accept.',
    template: "Attribute '{attribute}' is not accepted on '<{tag}>'. Try '{suggestion}'.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The template is what every artwork is drawn through, so a broken one breaks all of them rather than one slot.',
  },
  E_TEMPLATE_SYNTAX: {
    severity: 'error',
    summary: 'A template.html does not match the template grammar.',
    template: 'Template syntax error: {problem}.',
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The template is what every artwork is drawn through, so a broken one breaks all of ' +
      'them rather than one slot.',
  },
  E_TEMPLATE_MARKUP: {
    severity: 'error',
    summary: 'A template.html parses but does not describe a scene the compiler can build.',
    template: 'Template markup is invalid: {problem}.',
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The template is what every artwork is drawn through, so a broken one breaks all of them rather than one slot.',
  },
  E_PERMISSION: {
    severity: 'error',
    summary: 'A plugin called a capability it was not granted at install time.',
    template:
      "Plugin '{plugin}' called '{capability}' without that permission being granted at install time.",
    spec: 'docs/plugin-api.md',
    fatal: true,
    fatality: 'A plugin that did not load contributed no slot to skip.',
  },
  // Two codes and not one, the way the template manifest already splits them: "this file
  // is not JSON" and "this JSON is not a manifest" are different problems for whoever has
  // to fix it, and only the second has a field to point at. `{path}` is a file path in the
  // first and a field path in the second, which is the same split E_MANIFEST_* makes.
  E_PLUGIN_MANIFEST_SYNTAX: {
    severity: 'error',
    summary: 'A tyto-plugin.json is not valid JSON.',
    template: "Plugin manifest '{path}' is not valid JSON: {problem}.",
    spec: 'docs/plugin-api.md',
    fatal: true,
    fatality: 'A plugin that did not load contributed no slot to skip.',
  },
  E_PLUGIN_MANIFEST_SHAPE: {
    severity: 'error',
    summary: 'A tyto-plugin.json parses as JSON but does not match the plugin manifest schema.',
    template: "Plugin manifest is invalid at '{path}': {problem}.",
    spec: 'docs/plugin-api.md',
    fatal: true,
    fatality: 'A plugin that did not load contributed no slot to skip.',
  },
  E_SCENE_SHAPE: {
    severity: 'error',
    summary: 'A scene does not match the IR schema.',
    template: "Scene is invalid at '{path}': {problem}.",
    spec: 'docs/ir-schema.md',
    fatal: true,
    fatality: 'The IR is malformed, so the exporter has nothing it can draw.',
  },
  E_SCENE_DUPLICATE_ID: {
    severity: 'error',
    summary: 'The same id is used more than once in one scene.',
    template: "Id '{id}' is used {count} times; ids must be unique within a scene.",
    spec: 'docs/ir-schema.md',
    fatal: true,
    fatality: 'The IR is malformed, so the exporter has nothing it can draw.',
  },
  E_SCENE_MASK_NOT_FOUND: {
    severity: 'error',
    summary: 'A mask references a node the scene does not contain.',
    template: "Node '{id}' is masked by '{maskId}', which no node in the scene defines.",
    spec: 'docs/ir-schema.md',
    fatal: true,
    fatality: 'The IR is malformed, so the exporter has nothing it can draw.',
  },
  E_SCENE_MASK_DESCENDANT: {
    severity: 'error',
    summary: 'A mask references a descendant of the node it masks.',
    template: "Node '{id}' is masked by '{maskId}', which is one of its own descendants.",
    spec: 'docs/ir-schema.md',
    fatal: true,
    fatality: 'The IR is malformed, so the exporter has nothing it can draw.',
  },
  E_SCENE_FONT_NOT_DECLARED: {
    severity: 'error',
    summary: 'Text uses a font family the scene does not declare.',
    template: "Node '{id}' uses font family '{family}', which the scene does not declare.",
    spec: 'docs/ir-schema.md',
    fatal: true,
    fatality: 'The IR is malformed, so the exporter has nothing it can draw.',
  },
  E_SCENE_ASSET_NOT_DECLARED: {
    severity: 'error',
    summary: 'A node or paint uses an asset the scene does not declare.',
    template: "Node '{id}' uses asset '{assetId}', which the scene does not declare.",
    spec: 'docs/ir-schema.md',
    fatal: true,
    fatality: 'The IR is malformed, so the exporter has nothing it can draw.',
  },
  E_SCENE_EMPTY_TEXT: {
    severity: 'error',
    summary: 'A text node has nothing to draw — no runs at all, or only line breaks.',
    template: "Text node '{id}' has nothing to draw; it needs at least one run of text.",
    spec: 'docs/ir-schema.md',
    fatal: true,
    fatality: 'The IR is malformed, so the exporter has nothing it can draw.',
  },
  E_TEMPLATE_VALUE: {
    severity: 'error',
    summary: 'A template SDK builder was given a value it cannot turn into IR.',
    template: "Template value for '{field}' is invalid: {problem}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The template is what every artwork is drawn through, so a broken one breaks all of them rather than one slot.',
  },
  E_TEMPLATE_CRASH: {
    severity: 'error',
    summary: 'A template threw while building its scene, which is a bug in the template.',
    template: "Template '{template}' failed while building the scene: {problem}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The template is what every artwork is drawn through, so a broken one breaks all of them rather than one slot.',
  },
  // Read, then parse, then validate: the three ways a formats file fails, in the order it
  // fails them. The read used to report E_TEMPLATE_READ, which named the wrong kind of file
  // and told a diagnostics panel that a broken project was a broken template (TYTO-73).
  E_FORMATS_READ: {
    severity: 'error',
    summary: "The project's formats.yaml could not be read from the filesystem.",
    template: "Could not read formats file '{path}': {problem}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality: 'No formats file means no frame has a size.',
  },
  E_FORMATS_SYNTAX: {
    severity: 'error',
    summary: "The project's formats.yaml is not valid YAML.",
    template: "Formats file '{path}' is not valid YAML: {problem}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality: 'No formats file means no frame has a size.',
  },
  E_FORMATS_SHAPE: {
    severity: 'error',
    summary: 'A formats file parses as YAML but does not match the formats schema.',
    template: "Formats are invalid at '{path}': {problem}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality: 'No formats file means no frame has a size.',
  },
  E_FORMAT_NOT_DEFINED: {
    severity: 'error',
    summary: 'A template renders a format the project does not define a size for.',
    template:
      "Template '{template}' renders format '{format}', which the project does not define. Defined: {defined}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'A frame with no size cannot be drawn, and `compile` refuses before it builds anything — so the formats that are defined do not render either, which is what would have to change first.',
  },
  E_MANIFEST_SYNTAX: {
    severity: 'error',
    summary: 'A template manifest is not valid YAML.',
    template: "Manifest '{path}' is not valid YAML: {problem}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The registry answers with no manifest at all, and a manifest is what every slot is checked against.',
  },
  E_MANIFEST_SHAPE: {
    severity: 'error',
    summary: 'A template manifest parses as YAML but does not match the manifest schema.',
    template: "Manifest is invalid at '{path}': {problem}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The registry answers with no manifest at all, and a manifest is what every slot is checked against.',
  },
  E_TEMPLATE_DUPLICATE: {
    severity: 'error',
    summary: 'Two template folders declare the same manifest name.',
    template: "Template name '{name}' is declared by both '{first}' and '{second}'.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The registry answers with no manifest at all, and a manifest is what every slot is checked against.',
  },
  // A name with two bodies rather than two folders, which is why it is not
  // `E_TEMPLATE_DUPLICATE`: the registry sees one manifest and is right to. Only whoever
  // loads the build knows there are two ways to produce it, so this is the earliest
  // anybody could report it — and reporting beats picking, because a silent winner is a
  // template that changes behaviour when somebody edits the file it was ignoring.
  E_TEMPLATE_AMBIGUOUS: {
    severity: 'error',
    summary:
      'A template name has both bundled code and a markup file, and nothing decides which is drawn.',
    template:
      "Template '{name}' ships code and also has '{file}' in '{directory}'; keep one of the two.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'There is no template to build with, and a template is what every artwork is drawn through.',
  },
  // Says template, and now only means template: a folder, a manifest.yaml or a
  // template.html. What the path points at is in the message, so a reader does not have to
  // recognise a filename to know which of the three it was.
  E_TEMPLATE_READ: {
    severity: 'error',
    summary: 'A template folder, manifest or markup file could not be read from the filesystem.',
    template: "Could not read template '{path}': {problem}.",
    spec: 'docs/template-authoring.md',
    fatal: true,
    fatality:
      'The registry answers with no manifest at all, and a manifest is what every slot is checked against.',
  },
  E_INPUT_READ: {
    severity: 'error',
    summary: 'A file or folder a command was pointed at could not be read.',
    template: "Could not read '{path}': {problem}.",
    spec: 'docs/integrations.md',
    fatal: true,
    fatality: 'There is no brief to render.',
  },
  E_EXPORT_ASSET_UNRESOLVED: {
    severity: 'error',
    summary: 'An exporter was given no bytes for an asset the scene draws.',
    template:
      "Asset '{asset}' on '{node}' was not resolved to embeddable bytes, and an export makes no network requests.",
    spec: 'docs/ir-schema.md',
    fatal: false,
    fatality:
      'The bytes were never loaded, which is a wiring failure rather than something the ' +
      'brief said — and since ADR 0035 the exporter draws the gap mark in the box the ' +
      'picture would have filled, so the artwork names the hole itself.',
  },
  E_EXPORT_FONT_UNRESOLVED: {
    severity: 'error',
    summary: 'An exporter was given no bytes for a font the scene draws text in.',
    template:
      "Font '{font}' was not resolved to embeddable bytes; text would render in whatever the viewer has, and the output must be deterministic.",
    spec: 'docs/ir-schema.md',
    fatal: true,
    fatality:
      'Text drawn in whatever the viewer has is a different artwork, and the substitution is invisible in the output.',
  },
  E_EXPORT_UNSUPPORTED: {
    severity: 'error',
    summary: 'A scene uses something the chosen exporter cannot express at all.',
    template: "'{node}' uses {feature}, which {exporter} cannot express: {detail}.",
    spec: 'docs/ir-schema.md',
    fatal: false,
    fatality:
      'Every producer of this code now leaves the node visible rather than leaving it out ' +
      '(ADR 0035): a mask that cannot be built is dropped instead of hiding what it was ' +
      'applied to, and text that cannot be drawn as outlines is drawn as text.',
  },
  W_EXPORT_APPROXIMATED: {
    severity: 'warning',
    summary: 'An exporter rendered something close to, but not exactly, what the IR asked for.',
    template: "'{node}': {feature} is approximated by {exporter} — {detail}.",
    spec: 'docs/ir-schema.md',
    fatal: false,
    fatality: 'A warning never replaces a value (ADR 0013).',
  },
  E_RENDER_FAILED: {
    severity: 'error',
    summary: 'A frame could not be turned into bytes by the exporter or the rasterizer.',
    template: "Frame '{frame}' could not be rendered as {kind}: {problem}.",
    spec: 'docs/architecture.md',
    fatal: false,
    fatality:
      'One frame of twelve. The others are already written, and a file that is missing from `result.json` is visible in a way a hole inside an artwork is not.',
  },
  E_OUTPUT_WRITE: {
    severity: 'error',
    summary: 'An artifact was rendered but could not be written to the output.',
    template: "Could not write '{artifact}': {problem}.",
    spec: 'docs/architecture.md',
    fatal: false,
    fatality: 'The same: one artifact that did not reach the output, counted against `planned`.',
  },
  W_TEXT_OVERFLOW: {
    severity: 'warning',
    summary: 'Compiled text does not fit its frame in one of the requested formats.',
    template: "Text in slot '{slot}' overflows its frame by {overflow}px in format '{format}'.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'A warning never replaces a value (ADR 0013).',
  },
  W_UNUSED_SLOT: {
    severity: 'warning',
    summary: 'The brief sets a slot the chosen template never renders.',
    template: "Slot '{slot}' is set in the brief but template '{template}' does not use it.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'A warning never replaces a value (ADR 0013).',
  },
  W_MARKUP_IN_FRONTMATTER: {
    severity: 'warning',
    summary: 'A frontmatter scalar on a rich-text slot contains what looks like inline markup.',
    template:
      "Slot '{slot}' is set in the frontmatter, where '{markup}' is literal text. Write it as a ::{slot} directive for it to be markup.",
    spec: 'docs/brief-language.md',
    fatal: false,
    fatality: 'A warning never replaces a value (ADR 0013).',
  },
  // A warning and not an error, because nothing is wrong: the run produced the template the
  // user asked for. It exists because "my edit to the built-in did nothing" and "why does
  // mine look different on this machine" are the two questions shadowing will generate, and
  // one line answers both (ADR 0020).
  W_TEMPLATE_SHADOWED: {
    severity: 'warning',
    summary: 'Two template sources declare the same name; the earlier source is the one used.',
    template:
      "Template '{name}' in '{shadowed}' is shadowed by the one in '{used}', which is searched first.",
    spec: 'docs/adr/0020-built-in-template-pack.md',
    fatal: false,
    fatality: 'A warning never replaces a value (ADR 0013).',
  },
} as const satisfies Record<string, DiagnosticCodeDefinition>;

export type DiagnosticCode = keyof typeof diagnosticCodes;

export const diagnosticCodeList = Object.keys(diagnosticCodes) as readonly DiagnosticCode[];

export function diagnosticCodeDefinition(code: DiagnosticCode): DiagnosticCodeDefinition {
  return diagnosticCodes[code];
}

/**
 * Pulls `{name}` out of a template at the type level, so a caller that forgets a
 * parameter — or invents one — fails to compile instead of shipping a message with a
 * literal `{slot}` in it.
 */
type PlaceholderNames<Template extends string> =
  Template extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholderNames<Rest> : never;

export type DiagnosticParams<Code extends DiagnosticCode> = Readonly<
  Record<PlaceholderNames<(typeof diagnosticCodes)[Code]['template']>, string | number>
>;

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** Placeholder names in source order, with duplicates removed. */
export function placeholderNames(template: string): readonly string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

export function formatDiagnosticMessage<Code extends DiagnosticCode>(
  code: Code,
  params: DiagnosticParams<Code>,
): string {
  const { template } = diagnosticCodes[code];
  const supplied = params as Readonly<Record<string, string | number>>;
  return template.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = supplied[name];
    if (value === undefined) {
      // Types make this unreachable from TypeScript; a JavaScript caller gets a loud bug
      // report rather than a message with a raw placeholder in it.
      throw new TypeError(`Diagnostic ${code} is missing the parameter '${name}'.`);
    }
    return String(value);
  });
}
