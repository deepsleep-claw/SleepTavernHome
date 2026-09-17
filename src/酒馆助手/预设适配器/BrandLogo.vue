<template>
  <!-- eslint-disable-next-line vue/no-v-html -- 内容来自随包内置的 SVG 资源。 -->
  <span class="preset-adapter-brand-mark" aria-hidden="true" v-html="markup"></span>
</template>

<script setup lang="ts">
import logo_svg from './assets/sleeping-embrace.svg?raw';

const prefix = `preset-adapter-logo-${SillyTavern.uuidv4()}-`;
// 内置 SVG 的遮罩和图形引用按实例隔离，颜色由父级主题提供。
const markup = logo_svg
  .replace('<svg ', '<svg focusable="false" preserveAspectRatio="xMidYMid meet" ')
  .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
  .replace(/\bhref="#([^"]+)"/g, (_, id: string) => `href="#${prefix}${id}"`)
  .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}${id})`)
  .replace(
    /\baria-labelledby="([^"]+)"/g,
    (_, ids: string) =>
      `aria-labelledby="${ids
        .split(/\s+/)
        .map(id => prefix + id)
        .join(' ')}"`,
  );
</script>
