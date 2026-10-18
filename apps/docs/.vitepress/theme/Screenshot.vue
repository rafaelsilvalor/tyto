<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';

import { type ScreenshotMarker, screenshotPath } from '../../src/screenshots';

/**
 * A picture of the window in the reader's language and colour scheme (TYTO-314).
 *
 * Both themes' pictures are in the page and CSS shows one, keyed on the `dark` class
 * VitePress puts on `<html>`. That class follows the system scheme until the reader uses the
 * site's appearance switch, and the switch afterwards, so the picture matches the page around
 * it either way — `prefers-color-scheme` alone would show a dark window on a page the reader
 * switched to light.
 */
const props = defineProps<{
  scene: string;
  alt: string;
  markers?: readonly ScreenshotMarker[];
}>();

const { lang } = useData();
const light = computed(() => withBase(screenshotPath(lang.value, props.scene, 'tyto-light')));
const dark = computed(() => withBase(screenshotPath(lang.value, props.scene, 'tyto-dark')));
</script>

<template>
  <figure class="screenshot">
    <div class="screenshot__frame">
      <img class="screenshot__image screenshot__image--light" :src="light" :alt="alt" />
      <img class="screenshot__image screenshot__image--dark" :src="dark" :alt="alt" />
      <span
        v-for="marker in markers ?? []"
        :key="marker.n"
        class="screenshot__marker"
        :style="{ left: `${marker.x}%`, top: `${marker.y}%` }"
        aria-hidden="true"
        >{{ marker.n }}</span
      >
    </div>
  </figure>
</template>

<style>
.screenshot {
  margin: 16px 0;
}

.screenshot__frame {
  position: relative;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
}

.screenshot__image {
  display: block;
  width: 100%;
  height: auto;
}

.screenshot__image--dark,
.dark .screenshot__image--light {
  display: none;
}

.dark .screenshot__image--dark {
  display: block;
}

.screenshot__marker {
  position: absolute;
  transform: translate(-50%, -50%);
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  border-radius: 9px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--vp-c-bg);
}
</style>
