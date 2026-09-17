<template>
  <div v-if="usage" class="pa-debug-token-usage" aria-label="接口 Token 统计">
    <strong>接口 Token</strong>
    <span v-for="item in items" :key="item.label">{{ item.label }} {{ item.value.toLocaleString('zh-CN') }}</span>
    <small v-if="!usage.complete">部分统计</small>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DebugTokenUsage } from '../压缩相邻消息/debug_types';
const props = defineProps<{ usage?: DebugTokenUsage }>();
const items = computed(() => {
  const values = [
    { label: '输入', value: props.usage?.input_tokens },
    { label: '命中', value: props.usage?.cached_input_tokens },
    { label: '未命中', value: props.usage?.uncached_input_tokens },
    { label: '输出', value: props.usage?.output_tokens },
    { label: '思考', value: props.usage?.reasoning_tokens },
  ].filter((item): item is { label: string; value: number } => item.value !== undefined);
  if (!values.length) {
    if (props.usage?.total_tokens !== undefined) values.push({ label: '总计', value: props.usage.total_tokens });
    if (props.usage?.cache_write_tokens !== undefined)
      values.push({ label: '写入', value: props.usage.cache_write_tokens });
  }
  return values;
});
</script>

<style scoped>
.pa-debug-token-usage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.8rem;
  margin: 0.5rem 0;
  font-size: 0.8rem;
  color: var(--pa-muted);
}
.pa-debug-token-usage strong {
  font-weight: 500;
  color: var(--pa-text);
}
</style>
