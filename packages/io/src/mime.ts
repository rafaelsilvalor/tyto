/**
 * What a document can embed, by extension.
 *
 * Two adapters read folders of files for the exporters to embed — a brief's `assets/` and
 * a template's own folder — and both have to agree on which files are worth holding in
 * memory and on what `data:` URI they become. A `.psd` beside the logo is not an oversight
 * to report; it is a working file with no business in an export, and it is one list that
 * says so.
 */
export const EMBEDDABLE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

export function dataUri(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
