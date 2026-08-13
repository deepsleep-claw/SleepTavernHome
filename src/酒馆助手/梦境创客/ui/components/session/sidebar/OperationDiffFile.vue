<template>
  <article :id="`dca-diff-file-${anchorId}`" class="dca-unified-file" :class="[`kind-${file.kind}`, `state-${file.state}`]">
    <header>
      <button class="dca-unified-file-toggle" type="button" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
        <i :class="collapsed ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'" aria-hidden="true"></i>
        <i :class="fileIcon" aria-hidden="true"></i>
        <span>
          <strong>{{ file.path }}</strong>
          <small v-if="file.originalPath">{{ file.originalPath }} → {{ file.path }}</small>
        </span>
      </button>
      <span class="dca-unified-file-state">{{ stateLabel }}</span>
      <span class="dca-unified-file-lines"><b>+{{ file.addedLines }}</b><em>-{{ file.removedLines }}</em></span>
      <button
        class="dca-unified-open-file"
        type="button"
        :disabled="!openable"
        :title="openable ? '在文件视图打开' : '这个文件在当前工作区中不存在'"
        @click="emit('open-file', file.path)"
      >
        <i class="fa-regular fa-file-code" aria-hidden="true"></i>
        <span>在文件视图打开</span>
      </button>
    </header>

    <div v-if="!collapsed" class="dca-unified-file-body">
      <div v-if="file.binary" class="dca-unified-binary">
        <i class="fa-regular fa-file" aria-hidden="true"></i>
        <div>
          <strong>{{ kindLabel }}二进制文件</strong>
          <span>{{ file.mediaType }} · {{ formatBytes(binarySize) }}</span>
        </div>
      </div>
      <div v-else-if="file.rows.length === 0" class="dca-unified-empty">
        <i class="fa-solid fa-arrow-right-arrow-left" aria-hidden="true"></i>
        仅路径发生变化，文件内容未修改。
      </div>
      <div v-else class="dca-unified-lines" role="table" :aria-label="`${file.path} 的文件差异`">
        <template v-for="(row, index) in file.rows" :key="`${index}:${row.kind}`">
          <button
            v-if="row.kind === 'fold' && !expandedFolds.has(index)"
            class="dca-unified-fold"
            type="button"
            @click="expandFold(index)"
          >
            <span></span><span></span>
            <i class="fa-solid fa-angles-up-down" aria-hidden="true"></i>
            展开 {{ row.hidden.length }} 行未修改内容
          </button>
          <template v-else-if="row.kind === 'fold'">
            <div v-for="(hidden, hiddenIndex) in row.hidden" :key="`${index}:hidden:${hiddenIndex}`" class="dca-unified-line">
              <span>{{ hidden.oldLine }}</span>
              <span>{{ hidden.newLine }}</span>
              <i> </i>
              <code>{{ hidden.content || ' ' }}</code>
            </div>
          </template>
          <div v-else class="dca-unified-line" :class="`line-${row.kind}`">
            <span>{{ row.oldLine }}</span>
            <span>{{ row.newLine }}</span>
            <i>{{ linePrefix(row.kind) }}</i>
            <code>{{ row.content || ' ' }}</code>
          </div>
        </template>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatBytes } from '../../../composables/format';
import type { OperationDiffFile, OperationDiffRow } from '../../../composables/operation-diff';

const props = defineProps<{ file: OperationDiffFile; openable: boolean }>();
const emit = defineEmits<{ 'open-file': [path: string] }>();

const collapsed = ref(false);
const expandedFolds = ref(new Set<number>());
const anchorId = computed(() => encodeURIComponent(props.file.path).replace(/%/gu, '_'));
const binarySize = computed(() =>
  props.file.after?.external?.size ??
  props.file.after?.skillResource?.size ??
  props.file.before?.external?.size ??
  props.file.before?.skillResource?.size ??
  0,
);
const fileIcon = computed(() => {
  if (props.file.binary) return 'fa-regular fa-file';
  if (/\.ya?ml$/iu.test(props.file.path)) return 'fa-solid fa-code';
  if (/\.md$/iu.test(props.file.path)) return 'fa-brands fa-markdown';
  return 'fa-regular fa-file-lines';
});
const kindLabel = computed(() => ({ create: '新建', delete: '删除', modify: '修改', move: '移动' })[props.file.kind]);
const stateLabel = computed(() => {
  if (props.file.state === 'undone') return '已撤销';
  if (props.file.state === 'uncertain') return '恢复不可用';
  return kindLabel.value;
});

function expandFold(index: number) {
  expandedFolds.value = new Set([...expandedFolds.value, index]);
}

function linePrefix(kind: Exclude<OperationDiffRow['kind'], 'fold'>): string {
  if (kind === 'add') return '+';
  if (kind === 'delete') return '-';
  return ' ';
}
</script>

<style lang="scss">
.dca-unified-file {
  min-width: 0;
  // Diff 文档本身负责纵向滚动；文件卡不能为适配视口而压缩，否则正文会被 overflow 裁掉。
  flex: 0 0 auto;
  scroll-margin-top: 0.5rem;
  overflow: hidden;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  background: var(--dca-canvas);
}

.dca-unified-file > header {
  display: grid;
  min-height: 2.4rem;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.45rem;
  background: color-mix(in srgb, var(--dca-raised) 76%, var(--dca-canvas));
}

.dca-app .dca-unified-file-toggle,
.dca-app .dca-unified-open-file {
  border: 0;
  background: transparent;
  color: var(--dca-text-muted);
}

.dca-app .dca-unified-file-toggle {
  display: grid;
  min-width: 0;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: 0.42rem;
  padding: 0.15rem;
  text-align: left;
}

.dca-unified-file-toggle > i:nth-child(2) {
  color: var(--dca-info);
}

.dca-unified-file-toggle > span {
  display: grid;
  min-width: 0;
  gap: 0.08rem;
}

.dca-unified-file-toggle strong,
.dca-unified-file-toggle small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-unified-file-toggle strong {
  color: var(--dca-text);
  font: 0.72rem/1.35 var(--dca-font-mono);
}

.dca-unified-file-toggle small {
  color: var(--dca-text-muted);
  font-size: 0.64rem;
}

.dca-unified-file-state {
  border: 1px solid var(--dca-border);
  border-radius: 999px;
  padding: 0.12rem 0.42rem;
  color: var(--dca-text-muted);
  font-size: 0.64rem;
  white-space: nowrap;
}

.kind-create .dca-unified-file-state { color: var(--dca-success); }
.kind-delete .dca-unified-file-state,
.state-uncertain .dca-unified-file-state { color: var(--dca-danger); }
.kind-move .dca-unified-file-state { color: var(--dca-info); }
.state-undone .dca-unified-file-state { color: var(--dca-warning); }

.dca-unified-file-lines {
  display: inline-flex;
  gap: 0.28rem;
  font: 0.68rem/1 var(--dca-font-mono);
  white-space: nowrap;
}

.dca-unified-file-lines b { color: var(--dca-success); }
.dca-unified-file-lines em { color: var(--dca-danger); font-style: normal; }

.dca-app .dca-unified-open-file {
  display: inline-flex;
  min-height: 1.75rem;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.35rem;
  font-size: 0.68rem;
}

.dca-app .dca-unified-open-file:hover:not(:disabled) {
  background: var(--dca-accent-soft);
  color: var(--dca-text);
}

.dca-unified-file-body {
  overflow-x: auto;
  border-top: 1px solid var(--dca-border);
}

.dca-unified-lines {
  width: max-content;
  min-width: 100%;
  padding: 0.18rem 0;
  font: 11.5px/1.52 var(--dca-font-mono);
}

.dca-unified-line,
.dca-app .dca-unified-fold {
  display: grid;
  width: 100%;
  min-height: 1.52em;
  grid-template-columns: 3.2rem 3.2rem 1.2rem minmax(max-content, 1fr);
  align-items: stretch;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--dca-text-secondary);
  text-align: left;
}

.dca-unified-line > span,
.dca-unified-fold > span {
  padding: 0 0.5rem;
  border-right: 1px solid color-mix(in srgb, var(--dca-border) 72%, transparent);
  color: var(--dca-text-muted);
  text-align: right;
  user-select: none;
}

.dca-unified-line > i {
  color: var(--dca-text-muted);
  font-style: normal;
  text-align: center;
  user-select: none;
}

.dca-unified-line > code {
  display: block;
  padding: 0 0.55rem 0 0.15rem;
  color: inherit;
  white-space: pre;
}

.dca-unified-line.line-add {
  background: color-mix(in srgb, var(--dca-success) 15%, transparent);
  color: color-mix(in srgb, var(--dca-success) 82%, var(--dca-text));
}

.dca-unified-line.line-delete {
  background: color-mix(in srgb, var(--dca-danger) 14%, transparent);
  color: color-mix(in srgb, var(--dca-danger) 78%, var(--dca-text));
}

.dca-unified-line.line-add > span,
.dca-unified-line.line-add > i { background: color-mix(in srgb, var(--dca-success) 18%, transparent); }
.dca-unified-line.line-delete > span,
.dca-unified-line.line-delete > i { background: color-mix(in srgb, var(--dca-danger) 17%, transparent); }

.dca-app .dca-unified-fold {
  min-height: 1.9rem;
  align-items: center;
  background: color-mix(in srgb, var(--dca-info) 8%, var(--dca-canvas));
  color: var(--dca-info);
  font-size: 0.68rem;
}

.dca-unified-fold > i {
  text-align: center;
}

.dca-unified-binary,
.dca-unified-empty {
  display: flex;
  min-height: 6rem;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 1rem;
  color: var(--dca-text-muted);
  text-align: center;
}

.dca-unified-binary > div {
  display: grid;
  gap: 0.12rem;
  text-align: left;
}

.dca-unified-binary strong { color: var(--dca-text); }
.dca-unified-binary span { font-size: 0.7rem; }

@media (max-width: 720px) {
  .dca-unified-file > header {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .dca-unified-open-file span,
  .dca-unified-file-state { display: none; }
  .dca-unified-line,
  .dca-app .dca-unified-fold {
    grid-template-columns: 2.6rem 2.6rem 1rem minmax(max-content, 1fr);
  }
}
</style>
