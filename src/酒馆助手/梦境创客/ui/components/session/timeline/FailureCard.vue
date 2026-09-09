<template>
  <article v-if="failure" class="dca-inline-card dca-failure-card">
    <header>
      <div>
        <strong>{{
          state.active?.status === 'context-exhausted'
            ? '上下文不足'
            : state.active?.status === 'stopped'
              ? '本轮已停止'
              : '本轮运行中断'
        }}</strong>
        <span>已保留到最后一个成功步骤</span>
      </div>
      <i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>
    </header>
    <p>{{ failure }}</p>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useDreamCardAgent } from '../../../composables/runtime';

const { state } = useDreamCardAgent();

const failure = computed(() => {
  if (!['failed', 'context-exhausted', 'abnormal', 'stopped'].includes(state.value.active?.status ?? ''))
    return undefined;
  if (state.value.active?.error) return state.value.active.error;
  return [...state.value.active.events].reverse().find(event => event.type === 'status' && event.status === 'failed')
    ?.failure;
});
</script>
