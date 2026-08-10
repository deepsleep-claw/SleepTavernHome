<template>
  <article v-if="state.toolConfirmation" class="dca-inline-card dca-tool-confirmation">
    <header>
      <div>
        <strong>需要确认高危 Skill 操作</strong>
        <span>Agent 已暂停在当前步骤</span>
      </div>
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
    </header>
    <p>{{ state.toolConfirmation.description }}</p>
    <code>{{ state.toolConfirmation.toolName }} · {{ state.toolConfirmation.toolCallId }}</code>
    <div class="dca-row-actions">
      <button type="button" @click="resolve(false)">拒绝</button>
      <button class="dca-btn-danger" type="button" @click="resolve(true)">允许这一次</button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { useDreamCardAgent } from '../../../composables/runtime';

const { runtime, state } = useDreamCardAgent();

function resolve(approved: boolean) {
  runtime.resolveToolConfirmation(approved);
}
</script>
