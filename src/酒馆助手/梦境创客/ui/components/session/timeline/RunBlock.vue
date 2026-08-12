<template>
  <section class="dca-run-block" :class="`dca-run-${block.status}`">
    <button class="dca-run-summary" type="button" @click="emit('toggle')">
      <i :class="runStatusIcon(block.status)" aria-hidden="true"></i>
      <span>{{ runStatusLabel(block) }}</span>
      <small>{{ runContentSummary(block.items) }}</small>
      <i
        class="fa-solid fa-chevron-down dca-details-chevron"
        :class="{ 'dca-details-chevron-open': !collapsed }"
        aria-hidden="true"
      ></i>
    </button>
    <div v-show="!collapsed" class="dca-run-content">
      <template v-for="inner in contentBlocks" :key="inner.id">
        <ToolGroup v-if="inner.type === 'tools'" :items="inner.items" />
        <ManualChangeCard v-else-if="inner.item.kind === 'manual'" :item="inner.item" />
        <ReasoningBlock v-else-if="inner.item.kind === 'reasoning'" :item="inner.item" />
        <div v-else class="dca-step-text" :class="{ 'dca-step-text-assistant': inner.item.kind === 'assistant' }">
          <header v-if="inner.item.kind !== 'assistant'">
            <span>{{ itemKindLabel(inner.item.kind) }}</span>
          </header>
          <!-- eslint-disable vue/no-v-html -- 内容已由 ui/markdown.ts 的默认安全 Schema 清洗。 -->
          <div
            v-if="isMarkdownMessage(inner.item)"
            class="dca-markdown"
            v-html="renderMessageMarkdown(inner.item.content)"
          ></div>
          <!-- eslint-enable vue/no-v-html -->
          <p v-else>{{ cleanGuidance(inner.item.content) }}</p>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  cleanGuidance,
  isMarkdownMessage,
  itemKindLabel,
  runContentBlocks,
  runContentSummary,
  runStatusIcon,
  runStatusLabel,
  type RunTimelineBlock,
} from '../../../composables/timeline';
import { renderMarkdown } from '../../../markdown';
import ReasoningBlock from './ReasoningBlock.vue';
import ManualChangeCard from './ManualChangeCard.vue';
import ToolGroup from './ToolGroup.vue';

const props = defineProps<{ block: RunTimelineBlock; collapsed: boolean }>();
const emit = defineEmits<{ toggle: [] }>();

const contentBlocks = computed(() => runContentBlocks(props.block.items));

function renderMessageMarkdown(value: string): string {
  return renderMarkdown(cleanGuidance(value));
}
</script>

<style lang="scss">
.dca-run-block {
  width: 100%;
  align-self: flex-start;
  border: 1px solid var(--dca-border);
  border-radius: 0;
  background: var(--dca-surface);
}

.dca-app .dca-run-summary {
  display: grid;
  width: 100%;
  min-height: 2.3rem;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  border: 0;
  border-radius: 0;
  padding: 0.35rem 0.6rem;
  background: transparent;
  color: var(--dca-text-muted);
  text-align: left;
}

.dca-app .dca-run-summary:hover:not(:disabled) {
  background: var(--dca-raised);
}

.dca-run-summary > span {
  color: var(--dca-text);
  font-weight: 650;
}

.dca-run-summary > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// 运行状态色由摘要图标承担（不再使用左侧描边）
.dca-run-completed .dca-run-summary > i:first-child {
  color: var(--dca-success);
}

.dca-run-failed .dca-run-summary > i:first-child,
.dca-run-abnormal .dca-run-summary > i:first-child,
.dca-run-context-exhausted .dca-run-summary > i:first-child {
  color: var(--dca-danger);
}

.dca-run-stopped .dca-run-summary > i:first-child {
  color: var(--dca-warning);
}

.dca-run-running .dca-run-summary > i:first-child {
  color: var(--dca-info);
}

// ---------- 运行过程：竖向轨道 + 步骤卡片（KimiCode 风格） ----------

.dca-run-content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.55rem 0.6rem 0.65rem 1.55rem;
}

// 左侧竖向轨道线
.dca-run-content::before {
  position: absolute;
  top: 0.9rem;
  bottom: 0.9rem;
  left: 0.62rem;
  width: 1px;
  background: var(--dca-border-strong);
  content: '';
}

// 轨道上的状态圆点（由 ToolGroup / ReasoningBlock 的根元素携带）
.dca-step {
  position: relative;
}

.dca-step::before {
  position: absolute;
  z-index: 1;
  top: 0.72rem;
  left: -1.22rem;
  width: 0.55rem;
  height: 0.55rem;
  border: 2px solid var(--dca-surface);
  border-radius: 50%;
  background: var(--dca-text-muted);
  content: '';
}

.dca-step-tools::before {
  background: var(--dca-success);
}

.dca-step-tools.has-failure::before {
  background: var(--dca-danger);
}

.dca-step-tools.running::before {
  animation: dca-pulse 1.2s ease-in-out infinite;
  background: var(--dca-info);
}

.dca-step-reasoning::before {
  background: var(--dca-accent);
}

// 步骤卡片：直角矩形、1px 边框。注意不能用 overflow:hidden，否则会裁掉轨道圆点。
.dca-step-card {
  border: 1px solid var(--dca-border);
  border-radius: 0;
  background: var(--dca-canvas);
}

.dca-step-card > summary {
  display: grid;
  min-height: 2.2rem;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0;
  padding: 0.3rem 0.6rem;
}

.dca-step-card[open] > summary {
  border-radius: 0;
}

.dca-step-card > summary:hover {
  background: var(--dca-raised);
}

// 无预览文本时（思考已完成）chevron 仍靠右
.dca-step-card > summary > :last-child {
  justify-self: end;
}

// 运行中的中间文本：不使用卡片，降低视觉权重
.dca-step-text {
  min-width: 0;
  padding: 0.1rem 0.2rem;
}

.dca-step-text > header {
  display: flex;
  justify-content: space-between;
  gap: 0.65rem;
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}

.dca-step-text p {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.dca-step-text .dca-markdown {
  margin-top: 0.25rem;
  color: var(--dca-text-secondary);
}

</style>
