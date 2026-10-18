import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';

import Screenshot from './Screenshot.vue';

/** The default theme, plus the one component the pages use: `<Screenshot>`. */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Screenshot', Screenshot);
  },
} satisfies Theme;
