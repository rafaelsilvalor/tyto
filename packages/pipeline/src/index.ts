/**
 * @tyto/pipeline — a job: brief to artworks by formats to artifacts.
 *
 * Composes the pure stages and drives progress, cancellation, artifact naming and the
 * raster concurrency limit. Every capability is a port the caller injects, so nothing here
 * knows about a disk or a browser — which is what lets the same job run in the desktop
 * app, in the CLI and later in a cloud worker (ADR 0010).
 *
 * `docs/architecture.md` (Pipeline), ADR 0011 for the output contract.
 */

export {
  type Artifact,
  type ArtifactKind,
  type ArtifactSink,
  artifactExtension,
  artifactMimeType,
  artifactName,
} from './artifact.js';

export { type FrameTarget, type JobEvent, type JobListener, type JobStage } from './events.js';

export {
  type JobPorts,
  type JobReport,
  type JobRequest,
  type OutputRequest,
  runJob,
} from './job.js';

export { type Limiter, limiter } from './limit.js';

export {
  TEMPLATE_FILE,
  type MarkupTemplateSourceOptions,
  type TemplateSource,
  markupTemplateSource,
  renderedSlotsOf,
} from './template-source.js';
