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
  BrandKitContribution,
  Contribution,
  DirectiveContribution,
  EditorCommand,
  EditorKeymap,
  EditorVimContext,
  EditorVimContribution,
  EditorVimEx,
  EditorVimMapping,
  ExportFrameOptions,
  Exporter,
  ExporterRegistry,
  PanelCallAnswer,
  PanelCallRequest,
  PanelContribution,
  Provided,
  RasterizerContribution,
  SinkContribution,
  SourceContribution,
  IsolatedPackBuild,
  TemplatePack,
} from './contributions.js';

export {
  type AssetSourceContribution,
  type FontSourceContribution,
  type OwnedSource,
  type SourceRequest,
  type SourcedAsset,
  ASSET_SOURCE_MAX_BYTES,
  FONT_SOURCE_MAX_BYTES,
  SOURCE_SCHEME,
  schemeOf,
} from './sources.js';

export { directiveNamesOf, directiveResolverOf } from './directives.js';

export {
  type OwnedPanel,
  type PanelContributions,
  PANEL_CALL_MAX_BYTES,
  PANEL_CALL_METHOD,
  callPanel,
  panelCallerOf,
} from './panels.js';

export {
  type ResolvedThemeColors,
  type ThemeColorEntry,
  type ThemeColors,
  type ThemeContribution,
  type ThemeKind,
  THEME_KINDS,
  THEME_TOKEN_NAME,
  checkThemeContribution,
  isThemeColor,
  isThemePath,
  resolveThemeColors,
} from './theme.js';

export {
  type ConfigurationContribution,
  type DeclaredSetting,
  type FormConfigurationContribution,
  type ResolvedSettings,
  type SettingDeclaration,
  type SettingEntry,
  type SettingMemberRange,
  type SettingOption,
  declaredSetting,
  resolveSettings,
} from './configuration.js';

export { type SettingOutline, outlineOf } from './outline.js';
export {
  SETTING_FORM_LIMITS,
  type SettingForm,
  type SettingFormValue,
  type SettingListForm,
  type SettingScalarForm,
  type SettingScalarType,
  settingFormSchema,
  settingSchemaOf,
} from './setting-form.js';

export {
  type ContributionPoint,
  type PluginManifest,
  type ResolvedSigninDeclaration,
  type SigninDeclaration,
  SIGNIN_CLIENT_KEY_PREFIX,
  RECIPE_CREDENTIAL_KEY_PREFIX,
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
  type BrandKits,
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

export {
  type AppliedBatch,
  type AppliedBatchOperation,
  type ApplyRequest,
  type OwnedRecipeVerb,
  type PageRequest,
  type PlanRequest,
  type RecipeContributions,
  type RecipeDeclarations,
  type RecipeDerivationContribution,
  type RecipeRegistries,
  type RecipeRegistryOptions,
  type RecipeVerbContribution,
  type RecipeVerbKind,
  type TransformRequest,
  type VerbRequest,
  APPLY_BATCH,
  APPLY_NO_ANSWER,
  APPLY_REASON_MAX_LENGTH,
  RECIPE_VERB_KINDS,
  recipeRegistriesOf,
} from './recipes.js';

/**
 * The recipe's data port, named here so `@tyto/io`'s workspace adapter implements a port from
 * this package, as every adapter does (ADR 0137).
 */
export type { DataResolver } from '@tyto/recipe';

/**
 * The recipe's state port, named here for the same reason: the host's machine-local store
 * implements a port from this package (ADR 0140).
 */
export type { RecipeState } from '@tyto/recipe';

/**
 * The ports `to-brief` plans and applies through, named here for the same reason: the host's
 * workspace adapter implements a port from this package (ADR 0172).
 */
export type { BriefFolder, ToBriefPorts } from '@tyto/recipe';

/**
 * The ports `call` plans and sends through, named here for the same reason: the host's adapter
 * implements a port from this package (ADR 0193).
 */
export type { CallPorts, CallRequest, CallResponse } from '@tyto/recipe';

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
  type SandboxReport,
} from './isolation/protocol.js';

export { type GuestFaces, type ShippedFace, guestFaces } from './isolation/faces.js';
export { NO_SHIPPED_FILES, type ShippedFiles, guestFiles } from './isolation/files.js';
export { runGuest } from './isolation/guest.js';

export {
  type IsolatedPlugin,
  type IsolatedPluginOptions,
  PLUGIN_CALL_DEADLINE_MS,
  connectIsolatedPlugin,
} from './isolation/isolated-plugin.js';

export {
  CREDENTIAL_VALUE_LIMIT_BYTES,
  type FetchedResponse,
  type HostCache,
  type HostCapabilities,
  type HostCredentials,
  type HostFetchInit,
  type HostFetchResponse,
  type HostSignin,
  type HostWorkspace,
  PLUGIN_CACHE_KEY_LIMIT_BYTES,
  PLUGIN_FILE_LIMIT_BYTES,
  type PluginCacheEntry,
  type PluginCacheListing,
  type PluginCacheStored,
  type PluginCapabilities,
  type WorkspaceAccess,
  PluginCapabilityError,
  allowsCredential,
  allowsHost,
  allowsSignin,
  allowsWorkspace,
  bytesOf,
  checkedCapabilities,
  credentialByteLength,
  hostCache,
  hostCredentials,
  hostSignin,
  hostWorkspace,
  namesHost,
  workspacePath,
} from './capabilities.js';
// The host side of browser sign-in (ADR 0174), shared by the hosts that compose it (TYTO-683).
export {
  CALLBACK_PATH,
  CALLBACK_TIMEOUT_MS,
  type CallbackAddress,
  type CallbackListen,
  type CallbackListener,
  type CallbackOutcome,
  type CallbackPage,
  ENGLISH_CALLBACK_PAGE,
  LOOPBACK_HOST,
  type ListenOptions,
} from './signin-host/callback.js';
export {
  type AuthorizeRequest,
  type CodeExchange,
  type PkcePair,
  type RandomBytes,
  type TokenFetch,
  type TokenResult,
  type TokenSet,
  authorizeUrl,
  base64Url,
  createPkce,
  createState,
  exchangeCode,
  labelFromIdToken,
  parseTokenAnswer,
  pkceChallenge,
  refreshTokens,
} from './signin-host/oauth.js';
export {
  DEFAULT_SIGNIN_LABEL,
  type SigninClient,
  type SigninClientState,
  type SigninOutcome,
  type SigninRow,
  type SigninSecrets,
  type SigninService,
  type SigninServiceOptions,
  type SigninStatus,
  type StoredSignin,
  createSigninService,
  installedSigninDeclarations,
  listSignins,
  signinAccount,
  signinCapabilities,
  signinClientAccount,
} from './signin-host/service.js';
export {
  type HostStorage,
  PLUGIN_STORAGE_KEY_LIMIT,
  PLUGIN_STORAGE_VALUE_LIMIT_BYTES,
  type StorageCalls,
  hostStorage,
  jsonSafeProblem,
  storageKeyProblem,
} from './storage.js';
export {
  type CheckedProcess,
  type CheckedProcesses,
  type HostProcess,
  PLUGIN_PROCESS_LIMIT,
  PROCESS_PERMISSION,
  PROCESS_UNREAD_LIMIT_BYTES,
  PROCESS_WRITE_LIMIT_BYTES,
  PROGRAM_DATA_VARIABLE,
  type PluginProcess,
  type ProcessEvents,
  type ProcessExit,
  type ProcessOperations,
  type StartProcess,
  type StartedProcess,
  allowsProcess,
  checkedProcesses,
  hostProcess,
  type PluginProgramScripts,
  processChannel,
  programNameProblem,
  programScript,
  programScriptProblem,
} from './process.js';
export {
  type HostTerminal,
  type OpenTerminal,
  type OpenedTerminal,
  PLUGIN_TERMINAL_LIMIT,
  checkedTerminal,
  hostTerminal,
} from './terminal.js';
export {
  AGENT_SERVER_VARIABLES,
  type AgentServer,
  type AgentServerVariable,
  type HostWindow,
  type HostWindowCalls,
  WINDOW_AGENT_SERVER_NAME,
  WINDOW_TOOLS_PERMISSION,
  type WindowTool,
  type WindowToolContent,
  type WindowToolResult,
  agentServerSchema,
  checkedWindowAgentServer,
  checkedWindowTools,
  hostWindow,
  namesAProgram,
  windowToolInputSchema,
  windowToolResultSchema,
  windowToolSchema,
} from './window.js';

export {
  type ActivateOptions,
  type InstalledEntry,
  type InstalledPlugins,
  type LoadedPlugins,
  type StartOptions,
  NO_PLUGINS,
  PLUGIN_ENTRY_PATH,
  activateInstalled,
  readInstalledPlugins,
  startInstalledPlugins,
  writeCrash,
} from './installed.js';

export {
  type PluginFile,
  type PluginFileConfiguration,
  type PluginFileRead,
  type ArchiveSource,
  type GitSource,
  type PluginFileSource,
  type PluginFileSourceKind,
  type PluginFileTemplate,
  type PluginFilesCopy,
  type PluginFilesLock,
  type PluginFilesLockEntry,
  type PluginFolderSource,
  type PluginFolderSources,
  type PluginSyncStep,
  ARCHIVE_REF_PLACEHOLDER,
  EMPTY_PLUGIN_FILES_LOCK,
  PLUGIN_FILES_DIRECTORY,
  PLUGIN_FILES_LOCK_FILE,
  PLUGIN_FILE_EXTENSION,
  chooseCopies,
  configuredTemplates,
  folderSources,
  parsePluginFile,
  parsePluginFilesLock,
  archiveLocation,
  archiveProblem,
  pinOf,
  planPluginSync,
  sameSource,
  serializePluginFilesLock,
  sourceKind,
  sourceLocation,
} from './plugin-files.js';

export { addTemplateEntries, moveEntryRef, newPluginFileText } from './plugin-file-edit.js';

export {
  type GalleryEntry,
  type GalleryFolder,
  type GalleryIndex,
  type GalleryIndexRead,
  type GalleryKind,
  type GalleryPlacement,
  type GalleryState,
  type GalleryStatus,
  DEFAULT_GALLERY_INDEX,
  GALLERY_INDEX_FILE,
  galleryStatus,
  parseGalleryIndex,
  sameRepository,
} from './gallery-index.js';
