<template>
  <article v-if="confirmation" class="dca-inline-card dca-tool-confirmation">
    <header>
      <div>
        <strong>{{ confirmation.risk === 'high' ? '需要确认高风险操作' : 'Agent 请求写入' }}</strong>
        <span>Agent 已暂停在当前步骤</span>
      </div>
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
    </header>
    <p>{{ confirmation.description }}</p>
    <pre v-if="confirmation.intent !== undefined">{{ formattedIntent }}</pre>
    <code>{{ confirmation.toolName }} · {{ confirmation.toolCallId }}</code>
    <div class="dca-row-actions">
      <button type="button" @click="resolve(false)">拒绝</button>
      <button class="dca-btn-danger" type="button" @click="resolve(true)">允许这一次</button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useDreamCardAgent } from '../../../composables/runtime';

const { runtime, state } = useDreamCardAgent();
const confirmation = computed(() => {
  const request = state.value.toolConfirmation;
  return request?.sessionId === state.value.active?.sessionId ? request : undefined;
});
const formattedIntent = computed(() => JSON.stringify(confirmation.value?.intent, null, 2));

function resolve(approved: boolean) {
  runtime.resolveToolConfirmation(approved);
}
</script>
