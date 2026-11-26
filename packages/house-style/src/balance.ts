/**
 * The house's balanced setting: the kit's `balance` (TYTO-889 moved the mechanism there) with
 * the house's Portuguese function words (`breaks.ts`), so the product banner and every caller
 * of this module keep the API they had.
 */
import {
  type BalanceRequest as KitBalanceRequest,
  type Balanced,
  ENUMERATION_CAP,
  type SizeRange,
  balance as kitBalance,
} from '@tyto/template-kit';

import { FUNCTION_WORDS } from './breaks.js';

export { type Balanced, ENUMERATION_CAP, type SizeRange };

/** A balance request; the function words are the house's unless the caller names others. */
export type BalanceRequest = Omit<KitBalanceRequest, 'functionWords' | 'locale'> &
  Partial<Pick<KitBalanceRequest, 'functionWords' | 'locale'>>;

/** The kit's `balance`, ending no line on the house's function words where it can help it. */
export function balance(request: BalanceRequest): Balanced | undefined {
  return kitBalance({
    ...request,
    functionWords: request.functionWords ?? FUNCTION_WORDS,
    locale: request.locale ?? 'pt-BR',
  });
}
