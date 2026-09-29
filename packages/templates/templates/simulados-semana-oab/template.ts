/**
 * `simulados-semana-oab` — Estratégia OAB's weekly mock-exam agenda.
 *
 * The piece is drawn by `_estrategia/compose.ts` for three brands; this template is that
 * composition in Estratégia OAB's accent and sign-off (TYTO-200).
 */

import { OAB } from '../_estrategia/brands.js';
import { simuladosDaSemana } from '../_estrategia/compose.js';

import type { TemplateBuild } from '@tyto/core';

export const build: TemplateBuild = simuladosDaSemana(OAB);
