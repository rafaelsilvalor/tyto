/**
 * @tyto/house-style/azul — the azul brand's tokens, presets and parts.
 *
 * `tyto-template-agenda-semana` and `tyto-template-aprovados` draw in it, so it lives here
 * once instead of copied into each (TYTO-476). Its own entry, not part of the package root:
 * its tokens name `PAPER`, `INK`, `TYPE` and others the root's tokens also name, with
 * different values, as `./table-tokens` does.
 */
export * from './parts.js';
export * from './presets.js';
export * from './tokens.js';
