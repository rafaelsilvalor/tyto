import { describe, expect, it } from 'vitest';

import { externalUrlAllowed } from './external-url.js';

describe('externalUrlAllowed (TYTO-379)', () => {
  it.each(['https://example.com/a?b=c', 'http://127.0.0.1:8080/', 'HTTPS://EXAMPLE.COM'])(
    'lets %s open in the browser',
    (url) => {
      expect(externalUrlAllowed(url)).toBe(true);
    },
  );

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'ms-settings:privacy',
    'data:text/html,<p>x</p>',
    'mailto:someone@example.com',
    '//example.com/no-scheme',
    'example.com',
    '',
  ])('keeps %s in the app', (url) => {
    expect(externalUrlAllowed(url)).toBe(false);
  });
});
