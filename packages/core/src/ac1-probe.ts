// Deliberate violation for the TYTO-14 AC1 probe. This branch must never be merged.
import { readFileSync } from 'node:fs';

export const probe = (path: string): string => readFileSync(path, 'utf8');
