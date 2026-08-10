<template>
  <div class="dca-composer">
    <textarea
      v-model="message"
      rows="3"
      :disabled="!canCompose"
      :placeholder="
        isRunning
          ? '中途引导：追加到下一次工具调用后；若本轮已完成则成为下一条消息'
          : '例如：请检查角色动机，并补充三个互相呼应的世界书条目……'
      "
      @keydown.ctrl.enter.prevent="submit"
    ></textarea>
    <div class="dca-composer-footer">
      <small>{{ isRunning ? '运行中：发送即中途引导' : 'Ctrl + Enter 发送' }}</small>
      <div class="dca-row-actions">
        <button v-if="canResume" type="button" :disabled="state.busy" @click="resume">从中断处继续</button>
        <button v-if="isRunning" class="dca-btn-danger" type="button" @click="stop">停止</button>
        <button
          class="dca-btn-primary"
          type="button"
          :disabled="!message.trim() || (!isRunning && (!canSend || state.busy))"
          @click="submit"
        >
          {{ isRunning ? '引导' : '发送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';

const { action, runtime, state } = useDreamCardAgent();

const message = ref('');

const isRunning = computed(() => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''));
const canResume = computed(
  () =>
    ['abnormal', 'failed', 'stopped', 'context-exhausted'].includes(state.value.active?.status ?? '') &&
    !state.value.active?.approval,
);
const canSend = computed(() =>
  Boolean(
    state.value.active && ['completed', 'idle'].includes(state.value.active.status) && !state.value.active.approval,
  ),
);
const canCompose = computed(() => isRunning.value || canSend.value);

async function submit() {
  const text = message.value;
  if (isRunning.value) {
    try {
      runtime.enqueueGuidance(text);
      message.value = '';
    } catch (error) {
      toastr.error(error instanceof Error ? error.message : String(error), '梦境创客');
    }
    return;
  }
  if (await action(() => runtime.send(text))) message.value = '';
}

async function resume() {
  await action(() => runtime.resume());
}

function stop() {
  runtime.stop();
}
</script>

<style lang="scss">
.dca-composer {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.4rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.55rem 0.75rem 0.65rem;
  background: var(--dca-surface);
}

.dca-app .dca-composer textarea {
  width: min(52rem, 100%);
  align-self: center;
  border-radius: var(--dca-radius-md);
  background: var(--dca-canvas);
  resize: none;
}

.dca-composer-footer {
  display: flex;
  width: min(52rem, 100%);
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  align-self: center;
}

.dca-composer-footer > small {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
