import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';

/**
 * The one way a builder fails.
 *
 * Everything else the SDK could get wrong is a type error — a text without runs, a
 * gradient with one stop — and the schema catches whatever survives that. What neither
 * can catch is a value that is a `string` at the type level and nonsense at run time:
 * `color('#gggggg')`. That is a bug in a `template.ts`, which is code, not a mistake a
 * brief author can make, so it throws rather than travelling as a `Result` through every
 * builder's return type.
 *
 * It carries the `Diagnostic` already built, so the stage that runs the template (E4.2)
 * catches and collects it without having to invent a message of its own. That stage
 * catches every exception a template throws, not only this one: anything else is a bug in
 * third-party code and becomes `E_TEMPLATE_CRASH` (ADR 0014).
 */
export class TemplateError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(field: string, problem: string) {
    const built = diagnostic('E_TEMPLATE_VALUE', { field, problem });
    super(built.message);
    this.name = 'TemplateError';
    this.diagnostic = built;
  }
}
