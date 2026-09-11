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

export { isInside } from './contain.js';

export { type FileAssetResolverOptions, fileAssetResolver } from './file-assets.js';

export { type FileResourcesOptions, fileResources } from './file-resources.js';

export { ASSETS_DIR, BRIEF_FILE, type FsInboxOptions, fsInbox } from './fs-inbox.js';

export { OUT_DIR, RESULT_FILE, type FsOutboxOptions, fsOutbox } from './fs-outbox.js';

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
