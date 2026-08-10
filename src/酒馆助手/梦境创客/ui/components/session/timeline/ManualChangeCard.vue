<template>
  <details class="dca-manual-card" :open="item.manualStatus === 'failed'">
    <summary>
      <i class="fa-solid fa-user-pen" aria-hidden="true"></i>
      <span>玩家修改工作区</span>
      <small :class="`dca-manual-${item.manualStatus ?? 'active'}`">{{ statusLabel }}</small>
      <i class="fa-solid fa-chevron-down dca-details-chevron" aria-hidden="true"></i>
    </summary>
    <div class="dca-manual-content">
      <article v-for="change in changes" :key="change.path" class="dca-manual-change">
        <header>
          <code>{{ change.path }}</code>
          <span>{{ change.kind === 'delete' ? '删除' : '写入' }}</span>
        </header>
        <p v-if="change.error" class="dca-manual-error">{{ change.error }}</p>
        <details v-if="change.before !== undefined">
          <summary>修改前</summary>
          <pre>{{ change.before }}</pre>
        </details>
        <details v-if="change.after !== undefined">
          <summary>修改后</summary>
          <pre>{{ change.after }}</pre>
        </details>
      </article>
      <div class="dca-row-actions">
        <button v-if="item.manualStatus === 'undone'" type="button" @click="redo">重做玩家修改</button>
        <button v-else type="button" @click="undo">回退玩家修改</button>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ManualWorkspaceFileChange, SessionUiItem } from '../../../../core/session/types';
import { useDreamCardAgent } from '../../../composables/runtime';

const props = defineProps<{ item: SessionUiItem }>();
const { action, runtime } = useDreamCardAgent();

const changes = computed<ManualWorkspaceFileChange[]>(() => {
  try {
    const value = JSON.parse(props.item.content) as { changes?: ManualWorkspaceFileChange[] };
    return Array.isArray(value.changes) ? value.changes : [];
  } catch {
    return [];
  }
});
const statusLabel = computed(
  () => ({ active: '已保存', failed: '保存失败', undone: '已回退' })[props.item.manualStatus ?? 'active'],
);

async function undo() {
  await action(() => runtime.undo());
}

async function redo() {
  await action(() => runtime.redo());
}
</script>

<style lang="scss">
.dca-manual-card {
  width: min(48rem, 100%);
  align-self: flex-start;
  border: 1px solid rgb(104 190 160 / 45%);
  border-radius: var(--dca-radius-md);
  background: rgb(61 138 112 / 8%);
}

.dca-manual-card > summary {
  display: grid;
  min-height: 2.3rem;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
}

.dca-manual-card > summary > i:first-child,
.dca-manual-active {
  color: var(--dca-success);
}

.dca-manual-failed {
  color: var(--dca-danger);
}

.dca-manual-undone {
  color: var(--dca-text-muted);
}

.dca-manual-content {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.55rem;
}

.dca-manual-change {
  border: 1px solid var(--dca-border);
  padding: 0.45rem;
  background: var(--dca-canvas);
}

.dca-manual-change > header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.dca-manual-change code {
  overflow-wrap: anywhere;
}

.dca-manual-change pre {
  max-height: 18rem;
  overflow: auto;
  white-space: pre-wrap;
}

.dca-manual-error {
  color: var(--dca-danger);
}
</style>

