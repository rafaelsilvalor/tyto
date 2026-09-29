/**
 * `simulados-semana-ec` — Estratégia Concursos's weekly mock-exam agenda.
 *
 * The piece is drawn by `_estrategia/compose.ts` for three brands; this template is that
 * composition in Estratégia Concursos's accent and sign-off (TYTO-200).
 */

import { EC } from '../_estrategia/brands.js';
import { simuladosDaSemana } from '../_estrategia/compose.js';

import type { TemplateBuild } from '@tyto/core';

export const build: TemplateBuild = simuladosDaSemana(EC);
