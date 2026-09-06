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
}

export const diagnosticCodes = {
  E_UNKNOWN_SLOT: {
    severity: 'error',
    summary: 'A directive names a slot the template manifest does not declare.',
    template: "Unknown slot '{slot}'. Template '{template}' declares: {declared}.",
    spec: 'docs/brief-language.md',
  },
  E_UNKNOWN_DIRECTIVE: {
    severity: 'error',
    summary: 'A directive matches no template slot and no installed plugin.',
    template:
      "Unknown directive '::{directive}'. No template slot or installed plugin provides it.",
    spec: 'docs/brief-language.md',
  },
  E_MISSING_REQUIRED_SLOT: {
    severity: 'error',
    summary: 'The manifest marks a slot as required and the brief leaves it unset.',
    template: "Template '{template}' requires slot '{slot}', which the brief does not set.",
    spec: 'docs/brief-language.md',
  },
  E_BAD_ADJUSTMENT: {
    severity: 'error',
    summary: 'An adjustment is not declared for the slot it is applied to.',
    template: "Adjustment '{adjustment}' is not declared for slot '{slot}'. Declared: {declared}.",
    spec: 'docs/brief-language.md',
  },
  E_ASSET_NOT_FOUND: {
    severity: 'error',
    summary: 'An asset path in the brief does not resolve to a file.',
    template: "Asset '{path}' was not found relative to the brief at '{base}'.",
    spec: 'docs/brief-language.md',
  },
  E_UNSUPPORTED_CSS: {
    severity: 'error',
    summary: 'A template uses a CSS property outside the accepted set.',
    template:
      "CSS property '{property}' is not supported by the template language. Try '{suggestion}'.",
    spec: 'docs/template-authoring.md',
  },
  E_PERMISSION: {
    severity: 'error',
    summary: 'A plugin called a capability it was not granted at install time.',
    template:
      "Plugin '{plugin}' called '{capability}' without that permission being granted at install time.",
    spec: 'docs/plugin-api.md',
  },
  E_SCENE_SHAPE: {
    severity: 'error',
    summary: 'A scene does not match the IR schema.',
    template: "Scene is invalid at '{path}': {problem}.",
    spec: 'docs/ir-schema.md',
  },
  E_SCENE_DUPLICATE_ID: {
    severity: 'error',
    summary: 'The same id is used more than once in one scene.',
    template: "Id '{id}' is used {count} times; ids must be unique within a scene.",
    spec: 'docs/ir-schema.md',
  },
  E_SCENE_MASK_NOT_FOUND: {
    severity: 'error',
    summary: 'A mask references a node the scene does not contain.',
    template: "Node '{id}' is masked by '{maskId}', which no node in the scene defines.",
    spec: 'docs/ir-schema.md',
  },
  E_SCENE_MASK_DESCENDANT: {
    severity: 'error',
    summary: 'A mask references a descendant of the node it masks.',
    template: "Node '{id}' is masked by '{maskId}', which is one of its own descendants.",
    spec: 'docs/ir-schema.md',
  },
  E_SCENE_FONT_NOT_DECLARED: {
    severity: 'error',
    summary: 'Text uses a font family the scene does not declare.',
    template: "Node '{id}' uses font family '{family}', which the scene does not declare.",
    spec: 'docs/ir-schema.md',
  },
  E_SCENE_ASSET_NOT_DECLARED: {
    severity: 'error',
    summary: 'A node or paint uses an asset the scene does not declare.',
    template: "Node '{id}' uses asset '{assetId}', which the scene does not declare.",
    spec: 'docs/ir-schema.md',
  },
  E_SCENE_EMPTY_TEXT: {
    severity: 'error',
    summary: 'A text node carries no runs, so there is nothing to render.',
    template: "Text node '{id}' has no runs; there is nothing to render.",
    spec: 'docs/ir-schema.md',
  },
  W_TEXT_OVERFLOW: {
    severity: 'warning',
    summary: 'Compiled text does not fit its frame in one of the requested formats.',
    template: "Text in slot '{slot}' overflows its frame by {overflow}px in format '{format}'.",
    spec: 'docs/brief-language.md',
  },
  W_UNUSED_SLOT: {
    severity: 'warning',
    summary: 'The brief sets a slot the chosen template never renders.',
    template: "Slot '{slot}' is set in the brief but template '{template}' does not use it.",
    spec: 'docs/brief-language.md',
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
