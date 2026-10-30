import type { AssetRef, TemplateFiles } from '@tyto/core';

/**
 * The files of an installed code template's own folder, as they cross to its plugin's
 * process (ADR 0062, TYTO-478).
 *
 * `TemplateContext.files` answers synchronously, mid-build, and is functions, so it cannot
 * cross. What the functions would answer can: the host reads the template's folder, which
 * it already checked is inside the installed plugin, and sends each image as the ref it
 * read it as and each SVG as its markup. **No bytes of an image cross**, and nothing here
 * reads a disk: the export embeds the bytes the host kept, for a ref the host minted.
 *
 * A path is looked up as the template wrote it, so `../x.png`, an absolute path and any
 * file the host did not read answer `undefined`, as a missing file does (ADR 0062).
 */
export interface ShippedFiles {
  /** Folder-relative path, with forward slashes, to the ref the host read the image as. */
  readonly images: Readonly<Record<string, AssetRef>>;
  /** Folder-relative path, with forward slashes, to the SVG's markup. */
  readonly svgs: Readonly<Record<string, string>>;
}

/** What crosses for a template whose folder holds nothing a template can draw. */
export const NO_SHIPPED_FILES: ShippedFiles = { images: {}, svgs: {} };

/** `assets\logo.svg` and `./assets/logo.svg` name what the host keyed as `assets/logo.svg`. */
function templatePath(path: string): string {
  return path.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

/** The `files` a template is handed in its plugin's process, over what crossed. */
export function guestFiles(shipped: ShippedFiles): TemplateFiles {
  // Maps rather than the records themselves, so a path such as `__proto__` or
  // `constructor` is a missing file and not an inherited property.
  const images = new Map(Object.entries(shipped.images));
  const svgs = new Map(Object.entries(shipped.svgs));
  return {
    image: (path) => images.get(templatePath(path)),
    svg: (path) => svgs.get(templatePath(path)),
  };
}
