import { createHash } from 'node:crypto';

/**
 * `sha256-<hex>`, the form `AssetRef.hash` carries everywhere in the codebase.
 *
 * Content, not path or mtime: a designer who replaces `logo.png` with a different logo
 * under the same name has changed the artwork, and a cache keyed on the path would not
 * notice. Two adapters mint `AssetRef`s — the brief's assets and the template's — and a
 * second copy of this line is a second chance for the two to disagree about what a hash
 * looks like.
 */
export function hashOf(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}
