<template>
  <template v-for="(part, index) in parts" :key="`${index}:${part.type === 'render' ? part.id : part.content.slice(0, 20)}`">
    <!-- eslint-disable vue/no-v-html -- Markdown由统一安全渲染器清洗。 -->
    <div v-if="part.type === 'markdown' && part.content" class="dca-markdown" v-html="renderMarkdown(part.content)"></div>
    <!-- eslint-enable vue/no-v-html -->
    <RenderPreview v-else-if="part.type === 'render'" :render-id="part.id" />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '../../../markdown';
import RenderPreview from './RenderPreview.vue';

const props = defineProps<{ content: string }>();

type Part = { content: string; type: 'markdown' } | { id: string; type: 'render' };

const parts = computed<Part[]>(() => {
  const result: Part[] = [];
  const pattern = /<dream-render\s+id=["'](render_[\da-f-]+)["']\s*>\s*<\/dream-render>/giu;
  let cursor = 0;
  for (const match of props.content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push({ content: props.content.slice(cursor, index), type: 'markdown' });
    result.push({ id: match[1], type: 'render' });
    cursor = index + match[0].length;
  }
  if (cursor < props.content.length) result.push({ content: props.content.slice(cursor), type: 'markdown' });
  return result.length ? result : [{ content: props.content, type: 'markdown' }];
});
</script>
