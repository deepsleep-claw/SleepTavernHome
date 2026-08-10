<template>
  <article v-if="failure" class="dca-inline-card dca-failure-card">
    <header>
      <div>
        <strong>本轮运行失败</strong>
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
  if (state.value.active?.status !== 'failed') return undefined;
  return [...state.value.active.events].reverse().find(event => event.type === 'status' && event.status === 'failed')
    ?.failure;
});
</script>
