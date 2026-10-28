/**
 * `simulados-semana-vinho` — vinho's weekly mock-exam agenda.
 *
 * The piece is drawn by `house-style/src/compose.ts` for three brands; this template is that
 * composition in vinho's accent and sign-off (TYTO-200).
 */

import { VINHO, simuladosDaSemana } from '@tyto/house-style';

import type { TemplateBuild } from '@tyto/core';

export const build: TemplateBuild = simuladosDaSemana(VINHO);
