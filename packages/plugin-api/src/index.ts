/**
 * @tyto/plugin-api — extension points and the host contract (ADR 0007).
 *
 * Types and one in-process host, so it stays pure: nothing here reaches for a disk, a
 * browser or a process. Every built-in is registered through the same door a third party
 * uses, and since E11.1 the loader's rules live here too — the engine check, the approval
 * state, and an activation that answers with diagnostics — while the app that composes
 * them reads the folders. Isolation is E11.2.
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

export { directiveNamesOf, directiveResolverOf } from './directives.js';

export {
  type ContributionPoint,
  type PluginManifest,
  CONTRIBUTION_POINTS,
  parsePluginManifest,
  pluginManifestSchema,
  validatePluginManifest,
} from './manifest.js';

export { PLUGIN_API_VERSION, satisfiesEngine } from './engine.js';

export {
  type PluginStore,
  type StoredPlugin,
  checkInstallable,
  checkStoredPlugin,
  skippedPluginWarnings,
} from './loader.js';

export {
  type PluginCrash,
  type PluginCrashes,
  EMPTY_PLUGIN_CRASHES,
  parsePluginCrashes,
  serializePluginCrashes,
  withPluginCrash,
} from './crashes.js';

export {
  type PluginState,
  type PluginStateEntry,
  EMPTY_PLUGIN_STATE,
  parsePluginState,
  serializePluginState,
  withPluginEntry,
} from './state.js';

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

export type {
  GuestChannel,
  PluginChannel,
  PluginProcessLauncher,
  PluginProcessRequest,
} from './isolation/channel.js';

export {
  type GuestMessage,
  type HelloMessage,
  type HostMessage,
  RPC_PROTOCOL_VERSION,
} from './isolation/protocol.js';

export { runGuest } from './isolation/guest.js';

export {
  type IsolatedPlugin,
  type IsolatedPluginOptions,
  PLUGIN_CALL_DEADLINE_MS,
  connectIsolatedPlugin,
} from './isolation/isolated-plugin.js';

export {
  type FetchedResponse,
  type HostCapabilities,
  type HostFetchInit,
  type HostFetchResponse,
  type PluginCapabilities,
  PluginCapabilityError,
  allowsCredential,
  allowsHost,
  checkedCapabilities,
} from './capabilities.js';
