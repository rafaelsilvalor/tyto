/**
 * `simulados-semana-ecj` — Estratégia Carreira Jurídica's weekly mock-exam agenda.
 *
 * The piece is drawn by `_estrategia/compose.ts` for three brands; this template is that
 * composition in Estratégia Carreira Jurídica's accent and sign-off (TYTO-200).
 */

import { ECJ } from '../_estrategia/brands.js';
import { simuladosDaSemana } from '../_estrategia/compose.js';

import type { TemplateBuild } from '@tyto/core';

export const build: TemplateBuild = simuladosDaSemana(ECJ);
