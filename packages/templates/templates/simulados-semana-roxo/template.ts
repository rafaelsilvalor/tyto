/**
 * `simulados-semana-roxo` — Roxo's weekly mock-exam agenda.
 *
 * The piece is drawn by `_casa/compose.ts` for three brands; this template is that
 * composition in Roxo's accent and sign-off (TYTO-200).
 */

import { ROXO } from '../_casa/brands.js';
import { simuladosDaSemana } from '../_casa/compose.js';

import type { TemplateBuild } from '@tyto/core';

export const build: TemplateBuild = simuladosDaSemana(ROXO);
