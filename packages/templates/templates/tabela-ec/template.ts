/**
 * `tabela-ec` — Estratégia Concursos's table in one 1080×1350 image (TYTO-218).
 *
 * The piece is drawn by `_estrategia/table.ts` for any Estratégia brand; this template is that
 * composition in EC's accent and handle.
 */

import { EC_TABLE } from '../_estrategia/brands.js';
import { oneImageTable } from '../_estrategia/table.js';

import type { TemplateBuild } from '@tyto/core';

export const build: TemplateBuild = oneImageTable(EC_TABLE);
