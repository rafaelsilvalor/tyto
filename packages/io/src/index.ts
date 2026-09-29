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

export type { ExportResources } from './export-resources.js';

export {
  type DeliveredAsset,
  type FileAssetResolverOptions,
  briefAssetResolver,
  fileAssetResolver,
  recordingAssetResolver,
} from './file-assets.js';

export { type FileResources, type FileResourcesOptions, fileResources } from './file-resources.js';

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
