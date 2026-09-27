import type { Adjustment, Directive, Inline } from './ast.js';
import type { Diagnostics, Result } from '../result/result.js';

/**
 * The port `resolve` asks about a `::namespace/name` directive (E11.3, ADR 0043).
 *
 * Declared here because `resolve` is what consumes it, the way `AssetResolver` is: the
 * plugin host that fills it lives in `@tyto/plugin-api`, which depends on this package and
 * cannot be depended on by it.
 *
 * **A directive expands to slot directives, and that is the whole of what a plugin can
 * do to a brief.** It is handed the directive as the parser saw it and answers with
 * ordinary `::slot` directives, which `resolve` then checks against the manifest exactly
 * as if the author had typed them — so a plugin cannot put a value in a slot the template
 * does not declare, skip a `min`/`max`, or reach a `ResolvedBrief` at all. The narrowing
 * is deliberate; ADR 0043 says why.
 */
export interface DirectiveResolver {
  /**
   * The expansion of one directive, or `undefined` when nothing provides it — no plugin
   * owns the namespace, or the one that does declares no such name. `undefined` is what
   * makes `resolve` report `E_UNKNOWN_DIRECTIVE`.
   */
  find(namespace: string, name: string): DirectiveExpander | undefined;
}

/**
 * One plugin directive's transform.
 *
 * It may answer on the spot or later: an isolated plugin's answer comes back across a
 * thread, and a call past its deadline answers `E_PLUGIN_TIMEOUT` rather than never.
 */
export type DirectiveExpander = (
  directive: Directive,
) => ExpansionResult | Promise<ExpansionResult>;

export type ExpansionResult = Result<readonly ExpandedDirective[], Diagnostics>;

/** An inline as a plugin writes it: the same shapes as the AST's, without positions. */
export type ExpandedInline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bold'; readonly children: readonly ExpandedInline[] }
  | { readonly kind: 'italic'; readonly children: readonly ExpandedInline[] }
  | { readonly kind: 'break' }
  | {
      readonly kind: 'mark';
      readonly key: string;
      readonly value: string;
      readonly children: readonly ExpandedInline[];
    };

/**
 * A slot directive a plugin directive expands to.
 *
 * **No positions, and no namespace.** Every range in the replacement is the plugin
 * directive's own, stamped by `resolve`: a plugin has no text of its own to point into,
 * and a range it chose could point anywhere in somebody's brief. A namespace would make
 * the replacement another plugin directive, and expansion does not recurse — one step,
 * so a plugin cannot loop the resolver or hand its work to a plugin the author did not
 * ask for.
 */
export interface ExpandedDirective {
  readonly name: string;
  readonly adjustments?: readonly Omit<Adjustment, 'range'>[];
  readonly body: readonly ExpandedInline[];
}

/** The replacement as an AST directive, every position taken from the one it replaces. */
export function stampExpansion(expanded: ExpandedDirective, origin: Directive): Directive {
  const at = origin.range;
  const inline = (node: ExpandedInline): Inline => {
    switch (node.kind) {
      case 'text':
        return { kind: 'text', value: node.value, range: at };
      case 'break':
        return { kind: 'break', range: at };
      case 'bold':
      case 'italic':
        return { kind: node.kind, children: node.children.map(inline), range: at };
      case 'mark':
        return {
          kind: 'mark',
          key: node.key,
          value: node.value,
          children: node.children.map(inline),
          range: at,
        };
    }
  };
  return {
    name: expanded.name,
    adjustments: (expanded.adjustments ?? []).map((adjustment) => ({
      name: adjustment.name,
      ...(adjustment.value === undefined ? {} : { value: adjustment.value }),
      range: at,
    })),
    body: expanded.body.map(inline),
    range: at,
    nameRange: origin.nameRange,
  };
}
