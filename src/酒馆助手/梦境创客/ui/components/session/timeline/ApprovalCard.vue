<template>
  <article v-if="state.active?.approval" class="dca-inline-card dca-approval-card">
    <header>
      <div>
        <strong>本轮修改等待批准</strong>
        <span>{{ changeCount }} 项变更，批准后才写入酒馆</span>
      </div>
      <button type="button" @click="emit('open-diff')">在侧栏查看完整 Diff</button>
    </header>
    <div v-for="warning in state.active.approval.warnings" :key="warning" class="dca-inline-warning">
      {{ warning }}
    </div>
    <div
      v-for="change in approvalChanges"
      :key="change.path"
      class="dca-approval-row"
      :class="{ danger: change.highRisk }"
    >
      <div>
        <strong>{{ change.label }}</strong>
        <code>{{ change.path }}</code>
      </div>
      <label><input v-model="decisions[change.path]" type="radio" value="current" />保留当前</label>
      <label><input v-model="decisions[change.path]" type="radio" value="agent" />采用修改</label>
    </div>
    <div class="dca-row-actions">
      <button class="dca-btn-primary" type="button" :disabled="state.busy" @click="approve">提交已选修改</button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useDreamCardAgent } from '../../../composables/runtime';

const emit = defineEmits<{ 'open-diff': [] }>();

const { action, runtime, state } = useDreamCardAgent();

const decisions = reactive<Record<string, 'agent' | 'current' | undefined>>({});

const approvalChanges = computed(() => [
  ...(state.value.active?.approval?.stateChanges ?? []),
  ...(state.value.active?.approval?.fileChanges ?? []),
  ...(state.value.active?.approval?.skillChanges ?? []),
]);
const changeCount = computed(() => approvalChanges.value.length);

watch(
  () => state.value.active?.approval?.candidateSnapshot,
  () => {
    Object.keys(decisions).forEach(key => delete decisions[key]);
    approvalChanges.value.forEach(change => {
      decisions[change.path] = 'current';
    });
  },
);

async function approve() {
  await action(() =>
    runtime.approve(
      Object.fromEntries(Object.entries(decisions).filter(([, value]) => value)) as Record<string, 'agent' | 'current'>,
    ),
  );
}
</script>

<style lang="scss">
.dca-inline-card {
  width: 100%;
  align-self: center;
  border: 1px solid rgb(223 177 94 / 45%);
  border-radius: var(--dca-radius-lg);
  padding: 0.75rem 0.85rem;
  background: var(--dca-warning-soft);
  box-shadow: var(--dca-shadow-1);
}

.dca-inline-card > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem;
}

.dca-inline-card > header > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.1rem;
}

.dca-inline-card > header span {
  color: var(--dca-text-secondary);
  font-size: 0.8rem;
}

.dca-inline-card > header > i {
  color: var(--dca-warning);
  font-size: 1.1rem;
}

.dca-inline-card > p {
  margin: 0.5rem 0 0;
  overflow-wrap: anywhere;
}

.dca-inline-card > code {
  display: block;
  margin-top: 0.4rem;
  color: var(--dca-text-muted);
  font-family: var(--dca-font-mono);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.dca-inline-card .dca-row-actions {
  justify-content: flex-end;
  margin-top: 0.65rem;
}

.dca-inline-warning {
  margin: 0.45rem 0;
  color: var(--dca-warning);
}

.dca-approval-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.55rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.5rem 0;
}

.dca-approval-row > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-approval-row code {
  color: var(--dca-text-muted);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.dca-approval-row label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.84rem;
  white-space: nowrap;
}

.dca-approval-row.danger > div strong {
  color: #f2a3b3;
}

.dca-failure-card {
  border-color: rgb(224 108 130 / 45%);
  background: var(--dca-danger-soft);
}

.dca-failure-card > header > i {
  color: var(--dca-danger);
}

@media (max-width: 720px) {
  .dca-approval-row {
    grid-template-columns: 1fr 1fr;
  }

  .dca-approval-row > div {
    grid-column: 1 / -1;
  }
}
</style>
