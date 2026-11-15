import { ARCHIVE_MAX_BYTES } from './plugin-archive.js';

/**
 * Downloads an https URL's bytes, for a plugin file's archive source (ADR 0197). The seam
 * tests inject; the default is the runtime's own `fetch`, which follows redirects. A redirect
 * that leaves https is refused, so a `.zip` never travels in clear before the lock pins it.
 *
 * The one file of `@tyto/io` that opens a connection, so the lint exception that lets it use
 * `fetch` is scoped to it and no other module learns it may.
 */
export type ArchiveDownload = (url: string) => Promise<Uint8Array>;

export const downloadOverHttps: ArchiveDownload = async (url) => {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.url.startsWith('https://')) throw new Error('it was redirected away from https');
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > ARCHIVE_MAX_BYTES) {
    throw new Error(`it is larger than ${ARCHIVE_MAX_BYTES / 1024 / 1024} MB`);
  }
  return new Uint8Array(await response.arrayBuffer());
};
