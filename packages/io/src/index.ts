/**
 * @tyto/io — `BriefSource` and `OutputSink` ports with filesystem adapters.
 *
 * The inbox/outbox contract Jacurutu talks to (ADR 0011): a task folder with
 * `brief.brief` and `assets/` going in, an `out/` folder with artifacts and `result.json`
 * coming out. The same shape doubles as the integration-test harness and as what a person
 * drops a folder into by hand.
 *
 * Also the first adapters for two ports `core` has been asking questions of since E3.3:
 * `FileSystem` and `AssetResolver`. Node here, so the pure side stays pure (ADR 0010).
 */

export {
  EXIT_CODES,
  EXIT_DIAGNOSTICS,
  EXIT_INTERNAL,
  EXIT_OK,
  type ContractPath,
  type ExitCode,
} from './contract.js';

export { isInside } from './contain.js';

export {
  type FetchedFaces,
  type SourceCache,
  type SourceCacheOptions,
  type SourceCall,
  sourceCache,
} from './source-cache.js';

export type { ExportResources } from './export-resources.js';

export {
  type DeliveredAsset,
  type FileAssetResolverOptions,
  briefAssetResolver,
  fileAssetResolver,
  recordingAssetResolver,
} from './file-assets.js';

export { type FileResources, type FileResourcesOptions, fileResources } from './file-resources.js';

export { layeredExportResources } from './layered-resources.js';

export {
  type FileTemplateAssets,
  type FileTemplateAssetsOptions,
  fileTemplateAssets,
} from './file-template-assets.js';

export { ASSETS_DIR, BRIEF_FILE, type FsInboxOptions, fsInbox } from './fs-inbox.js';

export {
  EDITABLE_DIR,
  OUT_DIR,
  RESULT_FILE,
  TEMPLATE_FILE,
  type DeliveryOutput,
  type DeliveryTemplate,
  type FsDeliveryOutputOptions,
  type FsOutboxOptions,
  type FsTaskOutputOptions,
  type ReusableTaskOutput,
  fsDeliveryOutput,
  fsOutbox,
  fsTaskOutput,
} from './fs-outbox.js';

export type { LeftoverRun } from './leftovers.js';

export {
  PLUGIN_CRASHES_FILE,
  PLUGIN_MANIFEST_FILE,
  PLUGIN_STATE_FILE,
  PLUGINS_DIR,
  fsPluginStore,
} from './fs-plugin-store.js';
export {
  type InstalledCodePack,
  type InstalledPacks,
  type InstalledPacksOptions,
  NO_INSTALLED_PACKS,
  installedPacks,
  withoutRefused,
} from './installed-packs.js';
export {
  type InstalledTemplateFonts,
  type InstalledTemplateSourceOptions,
  type ReadTemplateFiles,
  installedTemplateSource,
} from './installed-templates.js';

export { type NodeFileSystemOptions, nodeFileSystem } from './node-file-system.js';

export { type PollOptions, pollSource } from './poll.js';

export type { BriefSource, BriefTask, OutputSink, TaskOutput } from './ports.js';

export {
  type RenderResult,
  type RenderResultInput,
  type ResultArtifact,
  parseRenderResult,
  renderResult,
  renderResultSchema,
  resultArtifactSchema,
  resultDiagnosticSchema,
} from './result.js';

export {
  type JsoncSyntaxCode,
  type JsoncText,
  type JsoncTextOptions,
  type JsoncValue,
  readJsoncText,
  readJsoncValue,
} from './jsonc-text.js';

export { type ProjectText, readProjectText } from './project-file.js';

export {
  type LoadWorkspaceOptions,
  type LoadedWorkspace,
  findWorkspace,
  loadWorkspace,
  projectFileOf,
} from './workspace.js';

export type { LoadedProfile } from './profile.js';

export {
  type WorkspaceDataOptions,
  DATA_FILE_MAX_BYTES,
  workspaceDataResolver,
} from './workspace-data.js';

export { type PluginCacheOptions, type PluginCachePorts, pluginCache } from './plugin-cache.js';

export {
  RECIPE_STATE_LIMIT_BYTES,
  type RecipeStateOptions,
  recipeStateStore,
} from './recipe-state.js';

export {
  type WorkspaceFilePorts,
  type WorkspaceFilesOptions,
  workspaceFiles,
} from './workspace-files.js';

export {
  type FsTrustStore,
  type FsTrustStoreOptions,
  TRUST_FILE,
  type TrustedEntry,
  fsTrustStore,
} from './fs-trust-store.js';
export {
  type FileReadListener,
  type PluginFilesCopyOnDisk,
  type PluginFolderRead,
  type SourceProblemListener,
  type SyncPluginFolderOptions,
  type SyncedFolder,
  PLUGIN_FILES_CACHE,
  cachedCopy,
  cleanPluginFilesCache,
  fetchToCache,
  locationOf,
  pluginStoreWithCopies,
  readPluginFolder,
  syncPluginFolder,
} from './plugin-files.js';
export { type PluginFileImagesOptions, pluginFileImages } from './plugin-file-images.js';
export {
  type PluginFilesApproval,
  type PluginFilesSyncOptions,
  type SyncedPluginFiles,
  NO_PLUGIN_FILES,
  machinePluginFiles,
  projectPluginFiles,
  syncPluginFiles,
} from './plugin-files-sync.js';
