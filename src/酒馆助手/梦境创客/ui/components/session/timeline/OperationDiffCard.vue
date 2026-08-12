<template>
  <article v-if="summary" class="dca-operation-diff-card">
    <header>
      <button class="dca-operation-summary" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
        <span class="dca-operation-icon"><i class="fa-regular fa-square-plus" aria-hidden="true"></i></span>
        <span>
          <strong>已变更 {{ summary.files }} 个文件</strong>
          <small><b>+{{ summary.addedLines }}</b><em>-{{ summary.removedLines }}</em></small>
        </span>
        <i :class="expanded ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'" aria-hidden="true"></i>
      </button>
      <div v-if="state.activeSessionAccess === 'live'" class="dca-operation-actions">
        <button v-if="canRedo" type="button" :disabled="state.busy" @click="action(() => runtime.redo())">
          重做 <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
        </button>
        <button v-if="canUndo" type="button" :disabled="state.busy" @click="action(() => runtime.undo())">
          撤销 <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
        </button>
        <button class="dca-operation-review" type="button" @click="openDiff(files[0]?.path)">审阅</button>
      </div>
    </header>

    <template v-if="expanded">
      <div class="dca-operation-diff-files">
        <button v-for="file in visibleFiles" :key="file.id" type="button" @click="openDiff(file.path)">
          <span>
            <i :class="fileIcon(file.path)" aria-hidden="true"></i>
            <code>{{ file.path }}</code>
          </span>
          <small><b>+{{ file.addedLines }}</b><em>-{{ file.removedLines }}</em></small>
        </button>
      </div>
      <button
        v-if="files.length > 3"
        class="dca-operation-show-more"
        type="button"
        @click="showAll = !showAll"
      >
        {{ showAll ? '收起文件列表' : `再显示 ${files.length - 3} 个文件` }}
        <i :class="showAll ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'" aria-hidden="true"></i>
      </button>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDreamCardAgent } from '../../../composables/runtime';
import {
  buildOperationDiffFiles,
  summarizeOperationDiffFiles,
  type OperationDiffFocus,
} from '../../../composables/operation-diff';

const emit = defineEmits<{ 'open-diff': [focus: OperationDiffFocus] }>();
const { action, runtime, state } = useDreamCardAgent();
const expanded = ref(true);
const showAll = ref(false);

const latestTurn = computed(() => state.value.active?.operationLog?.turns.at(-1));
const records = computed(() => {
  const turn = latestTurn.value;
  if (!turn) return [];
  const ids = new Set(turn.operationIds);
  return state.value.active?.operationLog?.records.filter(record => ids.has(record.operationId)) ?? [];
});
const files = computed(() => buildOperationDiffFiles(records.value));
const visibleFiles = computed(() => (showAll.value ? files.value : files.value.slice(0, 3)));
const canUndo = computed(() => records.value.some(record => record.state === 'applied' && record.undoable));
const canRedo = computed(() => {
  const redoIds = new Set(latestTurn.value?.redoOperationIds ?? []);
  return records.value.some(record => redoIds.has(record.operationId) && record.state === 'undone' && record.undoable);
});
const summary = computed(() => (files.value.length ? summarizeOperationDiffFiles(files.value) : undefined));

function openDiff(filePath?: string) {
  const turnId = latestTurn.value?.turnId;
  if (turnId) emit('open-diff', { filePath, turnId });
}

function fileIcon(path: string): string {
  if (/\.ya?ml$/iu.test(path)) return 'fa-solid fa-code';
  if (/\.md$/iu.test(path)) return 'fa-brands fa-markdown';
  return 'fa-regular fa-file-lines';
}
</script>

<style lang="scss">
.dca-operation-diff-card {
  overflow: hidden;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-md);
  background: color-mix(in srgb, var(--dca-raised) 55%, var(--dca-surface));
  container-name: dca-operation-card;
  container-type: inline-size;
}

.dca-operation-diff-card > header {
  display: flex;
  min-height: 3.35rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--dca-border);
}

.dca-app .dca-operation-summary {
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.55rem;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--dca-text-muted);
  text-align: left;
}

.dca-operation-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 0.45rem;
  background: var(--dca-canvas);
  color: var(--dca-text-secondary);
}

.dca-operation-summary > span:nth-child(2) {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.55rem;
  overflow: hidden;
}

.dca-operation-summary strong {
  overflow: hidden;
  color: var(--dca-text);
  font-size: 0.82rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-operation-summary small,
.dca-operation-diff-files small {
  display: inline-flex;
  gap: 0.28rem;
  font: 0.7rem/1 var(--dca-font-mono);
}

.dca-operation-summary b,
.dca-operation-diff-files b { color: var(--dca-success); }
.dca-operation-summary em,
.dca-operation-diff-files em { color: var(--dca-danger); font-style: normal; }

.dca-operation-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.28rem;
}

.dca-app .dca-operation-actions button,
.dca-app .dca-operation-show-more {
  border-color: transparent;
  background: transparent;
  color: var(--dca-text-secondary);
  font-size: 0.72rem;
}

.dca-app .dca-operation-actions button:hover:not(:disabled),
.dca-app .dca-operation-show-more:hover:not(:disabled) {
  background: var(--dca-accent-soft);
}

.dca-app .dca-operation-actions .dca-operation-review {
  border-color: var(--dca-border);
  border-radius: 999px;
  padding-inline: 0.65rem;
  background: var(--dca-canvas);
}

.dca-operation-diff-files {
  display: grid;
  padding: 0.25rem 0;
}

.dca-app .dca-operation-diff-files > button {
  display: flex;
  width: 100%;
  min-height: 2rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  border: 0;
  border-radius: 0;
  padding: 0.28rem 0.7rem;
  background: transparent;
  color: var(--dca-text-muted);
  text-align: left;
}

.dca-app .dca-operation-diff-files > button:hover {
  background: var(--dca-raised);
}

.dca-operation-diff-files > button > span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
}

.dca-operation-diff-files i { color: var(--dca-info); }
.dca-operation-diff-files code {
  overflow: hidden;
  color: var(--dca-text-secondary);
  font: 0.69rem/1.3 var(--dca-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-app .dca-operation-show-more {
  display: flex;
  width: 100%;
  justify-content: flex-start;
  gap: 0.4rem;
  border-top: 1px solid var(--dca-border);
  border-radius: 0;
  padding: 0.4rem 0.7rem;
}

@container dca-operation-card (max-width: 400px) {
  .dca-operation-diff-card > header {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .dca-operation-actions {
    width: 100%;
    justify-content: flex-end;
    border-top: 1px solid var(--dca-border);
    padding-top: 0.35rem;
  }
}

@media (max-width: 640px) {
  .dca-operation-diff-card > header { align-items: flex-start; }
  .dca-operation-summary > span:nth-child(2) { display: grid; gap: 0.18rem; }
  .dca-operation-actions button:not(.dca-operation-review) { font-size: 0; }
  .dca-operation-actions button:not(.dca-operation-review) i { font-size: 0.72rem; }
}
</style>
