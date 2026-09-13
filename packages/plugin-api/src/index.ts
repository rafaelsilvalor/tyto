/**
 * @tyto/plugin-api — extension points and the host contract (ADR 0007).
 *
 * Types and one in-process host, so it stays pure: nothing here reaches for a disk, a
 * browser or a process. Phase 1 of `docs/plugin-api.md` — no loader, no permissions, no
 * isolation, and **every built-in registered through the same door a third party will
 * use**, which is the only way to find out whether that door works before opening it.
 */

export type {
  Contribution,
  DirectiveContribution,
  EditorCommand,
  EditorKeymap,
  ExportFrameOptions,
  Exporter,
  ExporterRegistry,
  PanelContribution,
  Provided,
  RasterizerContribution,
  SinkContribution,
  SourceContribution,
  TemplatePack,
} from './contributions.js';

export {
  type ContributionPoint,
  type PluginManifest,
  CONTRIBUTION_POINTS,
  parsePluginManifest,
  pluginManifestSchema,
  validatePluginManifest,
} from './manifest.js';

export {
  type Disposable,
  type HostEventListener,
  type HostEvents,
  type InProcessHost,
  type InstalledPlugin,
  type Logger,
  type Plugin,
  type PluginHost,
  type PluginHostOptions,
  type PluginOrigin,
  type PluginRegistry,
  type TypedEmitter,
  createPluginHost,
} from './host.js';
