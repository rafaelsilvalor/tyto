import type { DirectiveResolver } from '@tyto/core';

import type { DirectiveContribution } from './contributions.js';

/**
 * The `directive` point, as the port `resolve` asks (ADR 0043).
 *
 * Read per call rather than copied, so a directive withdrawn from the host — a plugin
 * whose activation lost an `E_PLUGIN_DUPLICATE` — stops resolving without anybody
 * rebuilding this.
 */
export function directiveResolverOf(
  directives: () => readonly DirectiveContribution[],
): DirectiveResolver {
  return {
    find(namespace, name) {
      const owner = directives().find((directive) => directive.id === namespace);
      if (owner === undefined || !owner.names.includes(name)) return undefined;
      return (directive) => owner.transform(directive);
    },
  };
}

/** `ns/name` for every directive the host offers, in registration order — for autocomplete. */
export function directiveNamesOf(directives: readonly DirectiveContribution[]): string[] {
  return directives.flatMap((directive) =>
    directive.names.map((name) => `${directive.id}/${name}`),
  );
}
