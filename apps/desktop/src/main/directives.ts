import type { DirectiveResolver } from '@tyto/core';
import {
  type LoadedPlugins,
  createPluginHost,
  directiveNamesOf,
  directiveResolverOf,
} from '@tyto/plugin-api';

/**
 * The installed plugins' `::namespace/name` directives, for the window (TYTO-49, ADR 0043).
 *
 * An export builds a host per run and activates the installed plugins into it, so a run
 * resolves through that host. The preview has no such host — it compiles on every
 * keystroke and binds no exporter — so it reads this one: activated once, when the plugins
 * have started, and holding nothing but what they registered. **Directives only**: an
 * installed exporter's refusals are the export's to report, and this host is never asked
 * for one.
 *
 * Until the plugins have started it offers no directive, so a `::demo/shout` typed in the
 * first second is `E_UNKNOWN_DIRECTIVE` and the next preview after start-up clears it —
 * the window opening is not made to wait on a plugin's activation (ADR 0044).
 */
export interface WindowDirectives {
  readonly resolver: DirectiveResolver;
  /** `namespace/name`, for completion after `::`. */
  names(): readonly string[];
}

export function windowDirectives(plugins: Promise<LoadedPlugins>): WindowDirectives {
  const host = createPluginHost();
  let ready = false;
  void plugins.then((loaded) => {
    // A plugin this host refuses is refused by the export too, where the run reports it;
    // saying it twice on every keystroke would bury the one that matters.
    for (const plugin of loaded.plugins) host.tryActivate(plugin, 'external');
    ready = true;
  });

  const directives = () => (ready ? host.registry.directives() : []);
  return {
    resolver: directiveResolverOf(directives),
    names: () => directiveNamesOf(directives()),
  };
}
