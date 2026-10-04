/**
 * `tabela-roxo` — roxo's table in one 1080×1350 image (TYTO-218).
 *
 * The piece is drawn by `_casa/table.ts` for any brand of the house; this template is that
 * composition in roxo's accent and signature.
 */

import { ROXO_TABLE } from '../_casa/brands.js';
import { oneImageTable } from '../_casa/table.js';

import type { TemplateBuild } from '@tyto/core';

export const build: TemplateBuild = oneImageTable(ROXO_TABLE);
