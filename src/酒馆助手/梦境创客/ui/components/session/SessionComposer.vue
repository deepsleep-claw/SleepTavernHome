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
      <div class="dca-composer-controls">
        <button
          v-if="supportsWebSearch"
          class="dca-web-toggle"
          :class="{ active: state.active?.modelControls?.webSearch }"
          type="button"
          :disabled="isRunning || state.busy"
          :title="state.active?.modelControls?.webSearch ? '本轮已启用内置联网' : '为下一轮启用内置联网'"
          @click="toggleWebSearch"
        >
          <i class="fa-solid fa-globe" aria-hidden="true"></i>
          <span>联网</span>
        </button>
        <small>{{ isRunning ? '运行中：发送即中途引导' : 'Ctrl + Enter 发送' }}</small>
      </div>
      <div class="dca-row-actions">
        <button v-if="canResume" type="button" :disabled="state.busy" @click="resume">从中断处继续</button>
        <button v-if="isRunning" class="dca-btn-danger" type="button" @click="stop">停止</button>
        <select
          v-if="supportsReasoning"
          class="dca-reasoning-select"
          :value="state.active?.modelControls?.reasoningEffort ?? 'auto'"
          :disabled="isRunning || state.busy"
          title="本会话的推理强度"
          @change="changeReasoning"
        >
          <option value="auto">推理：自动</option>
          <option value="off">推理：关闭</option>
          <option v-for="effort in reasoningEfforts" :key="effort.id" :value="effort.id">
            推理：{{ effort.name }}
          </option>
        </select>
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

const activeProfile = computed(() => state.value.profiles.find(profile => profile.id === state.value.activeProfileId));
const supportsWebSearch = computed(
  () =>
    Boolean(activeProfile.value) &&
    ['anthropic', 'openai-responses'].includes(activeProfile.value!.protocol) &&
    activeProfile.value?.modelSettings?.capabilities.webSearch !== 'disabled',
);
const supportsReasoning = computed(
  () => Boolean(activeProfile.value) && activeProfile.value?.modelSettings?.capabilities.reasoning !== 'disabled',
);
const reasoningEfforts = computed(() => activeProfile.value?.modelSettings?.reasoningEfforts ?? []);

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

async function toggleWebSearch() {
  await action(() => runtime.setModelControls({ webSearch: !state.value.active?.modelControls?.webSearch }));
}

async function changeReasoning(event: Event) {
  await action(() => runtime.setModelControls({ reasoningEffort: (event.target as HTMLSelectElement).value }));
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

.dca-composer-controls {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
}

.dca-composer-controls > small {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-app .dca-web-toggle {
  display: flex;
  min-height: 1.85rem;
  align-items: center;
  gap: 0.3rem;
  border-color: transparent;
  padding: 0.2rem 0.45rem;
  background: transparent;
  color: var(--dca-text-muted);
  font-size: 0.74rem;
}

.dca-app .dca-web-toggle.active {
  border-color: rgb(157 124 255 / 45%);
  background: var(--dca-accent-soft);
  color: var(--dca-accent);
}

.dca-app .dca-reasoning-select {
  width: auto;
  min-width: 7rem;
  min-height: 2rem;
  padding: 0.2rem 1.65rem 0.2rem 0.45rem;
  font-size: 0.76rem;
}

@media (max-width: 620px) {
  .dca-composer-controls > small {
    display: none;
  }

  .dca-web-toggle span {
    display: none;
  }
}
</style>
