<template>
  <article v-if="summary" class="dca-operation-diff-card">
    <header>
      <div>
        <strong>本轮文件修改</strong>
        <span>{{ summary.files }} 个文件 · +{{ summary.added }} / -{{ summary.removed }} 行</span>
      </div>
      <button type="button" @click="openDiff">查看 Diff</button>
    </header>
    <div class="dca-operation-diff-files">
      <code v-for="path in summary.paths.slice(0, 4)" :key="path">{{ path }}</code>
      <span v-if="summary.paths.length > 4">另有 {{ summary.paths.length - 4 }} 个文件</span>
    </div>
    <footer v-if="state.activeSessionAccess === 'live'">
      <button v-if="canRedo" type="button" :disabled="state.busy" @click="action(() => runtime.redo())">重做本轮</button>
      <button v-if="canUndo" type="button" :disabled="state.busy" @click="action(() => runtime.undo())">撤销本轮</button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { summarizeUnifiedPatch } from '../../../../core/workspace/unified-patch';
import { useDreamCardAgent } from '../../../composables/runtime';

const emit = defineEmits<{ 'open-diff': [] }>();
const { action, runtime, state } = useDreamCardAgent();

const latestTurn = computed(() => state.value.active?.operationLog?.turns.at(-1));
const records = computed(() => {
  const turn = latestTurn.value;
  if (!turn) return [];
  const ids = new Set(turn.operationIds);
  return state.value.active?.operationLog?.records.filter(record => ids.has(record.operationId)) ?? [];
});
const canUndo = computed(() => records.value.some(record => record.state === 'applied' && record.undoable));
const canRedo = computed(() => {
  const redoIds = new Set(latestTurn.value?.redoOperationIds ?? []);
  return records.value.some(record => redoIds.has(record.operationId) && record.state === 'undone' && record.undoable);
});
const summary = computed(() => {
  if (records.value.length === 0) return undefined;
  let added = 0;
  let removed = 0;
  const paths = new Set<string>();
  for (const record of records.value) {
    paths.add(record.forward.path);
    if (record.forward.kind === 'move') paths.add(record.forward.from);
    if (record.forward.kind === 'modify') {
      const patch = summarizeUnifiedPatch(record.forward.forwardPatch);
      added += patch.addedLines;
      removed += patch.removedLines;
    } else if (record.forward.kind === 'create') added += record.forward.file.content.split(/\r?\n/u).length;
    else if (record.forward.kind === 'delete') removed += record.forward.file.content.split(/\r?\n/u).length;
  }
  return { added, files: paths.size, paths: [...paths], removed };
});

function openDiff() {
  emit('open-diff');
}
</script>

<style lang="scss">
.dca-operation-diff-card {
  display: grid;
  gap: 0.55rem;
  border: 1px solid color-mix(in srgb, var(--dca-success) 35%, var(--dca-border));
  border-radius: var(--dca-radius-md);
  padding: 0.75rem;
  background: color-mix(in srgb, var(--dca-success) 6%, var(--dca-surface));
}
.dca-operation-diff-card header,
.dca-operation-diff-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}
.dca-operation-diff-card header > div { display: grid; gap: 0.15rem; }
.dca-operation-diff-card header span,
.dca-operation-diff-files span { color: var(--dca-text-muted); font-size: 0.72rem; }
.dca-operation-diff-files { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.dca-operation-diff-files code { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dca-operation-diff-card footer { justify-content: flex-end; }
</style>
