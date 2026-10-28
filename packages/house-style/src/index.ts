/**
 * @tyto/house-style — one publisher's look: its tokens, presets and the parts drawn in it.
 *
 * It was `packages/templates/templates/_casa`, a folder the built-in templates reached by
 * relative path. A template in its own repository cannot reach a folder inside this one, so the
 * folder became a package it depends on by version (ADR 0151 decision 8). It is not part of
 * `@tyto/template-kit`: the kit's own index says brand tokens are not the kit's to decide
 * (ADR 0047), and a colour tweak here must not bump a template that uses only the kit.
 *
 * Pure like the kit (ADR 0010): no Node or DOM import, enforced by the same lint rule.
 *
 * The table's tokens are `@tyto/house-style/table-tokens`, not part of this root: they and
 * `tokens.ts` both name `TITLE`, `PAPER` and `ON_ACCENT`, with different values, and a barrel
 * cannot re-export both under one name.
 */
export * from './balance.js';
export * from './banner.js';
export * from './brands.js';
export * from './breaks.js';
export * from './compose.js';
export * from './kit.js';
export * from './marks.js';
export * from './parts.js';
export * from './presets.js';
export * from './seal.js';
export * from './table-text.js';
export * from './table.js';
export * from './tokens.js';
