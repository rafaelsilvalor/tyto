/**
 * The example pack's code: one call, in `activate`, registering the folder of templates.
 *
 * `directory` is relative to this plugin's installed folder, and Tyto refuses one that leads
 * out of it (ADR 0046). `templates` may stay empty: Tyto reads the manifests from the folder
 * itself, with the same parser a project's templates go through.
 *
 * Plain ES module JavaScript with no imports, so there is nothing to build and nothing to
 * install before `tyto plugin install` (docs/plugin-authoring.md).
 */
export function activate(host) {
  host.registerTemplatePack({ id: 'example-pack', templates: [], directory: 'templates' });
}
