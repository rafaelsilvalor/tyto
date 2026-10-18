import desktop from '../../desktop/package.json' with { type: 'json' };

/**
 * The version the header shows: the desktop app's, because the app is what a reader of
 * the manual installed. Imported rather than written down, so a release that bumps the
 * app cannot leave the manual naming the one before.
 */
export const DESKTOP_VERSION: string = desktop.version;
