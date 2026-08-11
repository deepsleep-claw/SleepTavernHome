<template>
  <article
    class="dca-tool-result-card"
    :class="[
      `dca-tool-result-${presentation.tone}`,
      `dca-tool-result-${tool.status ?? 'completed'}`,
      { 'dca-tool-result-expanded': expanded },
    ]"
  >
    <header class="dca-tool-result-header">
      <span class="dca-tool-result-icon" aria-hidden="true"><i :class="presentation.icon"></i></span>
      <div class="dca-tool-result-heading">
        <strong>{{ presentation.title }}</strong>
        <span>{{ presentation.summary }}</span>
      </div>
      <small class="dca-tool-result-status" :class="`dca-tool-${tool.status ?? 'completed'}`">
        <i :class="statusIcon" aria-hidden="true"></i>
        {{ toolStatusLabel(tool.status) }}
      </small>
      <button
        class="dca-tool-raw-toggle"
        type="button"
        :aria-expanded="rawOpen"
        :title="rawOpen ? '收起原始数据' : '查看原始输入和输出'"
        @click="rawOpen = !rawOpen"
      >
        <i class="fa-solid fa-code" aria-hidden="true"></i>
        <span>原始数据</span>
      </button>
    </header>

    <div v-if="presentation.path" class="dca-tool-result-path" :title="presentation.path">
      <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
      <code>{{ presentation.path }}</code>
    </div>

    <div v-if="presentation.metrics.length > 0" class="dca-tool-metrics">
      <span
        v-for="metric in presentation.metrics"
        :key="`${metric.label}:${metric.value}`"
        class="dca-tool-metric"
        :class="metric.tone ? `dca-tool-metric-${metric.tone}` : undefined"
      >
        <small>{{ metric.label }}</small>
        <strong>{{ metric.value }}</strong>
      </span>
    </div>

    <div
      v-if="presentation.preview"
      class="dca-tool-content-scroll dca-tool-preview"
      :class="[`dca-tool-preview-${presentation.preview.mode}`, { expanded }]"
      tabindex="0"
    >
      <code v-if="presentation.preview.mode === 'diff'" class="dca-tool-diff">
        <span v-for="(line, index) in previewLines" :key="`${index}:${line}`" :class="diffLineClass(line)">{{
          line || ' '
        }}</span>
      </code>
      <pre v-else>{{ presentation.preview.content }}</pre>
    </div>

    <div
      v-if="presentation.rows.length > 0"
      class="dca-tool-content-scroll dca-tool-result-rows"
      :class="{ expanded }"
      tabindex="0"
    >
      <div v-for="(row, index) in presentation.rows" :key="`${index}:${row.label}`" class="dca-tool-result-row">
        <i :class="row.icon ?? 'fa-regular fa-circle'" aria-hidden="true"></i>
        <div>
          <strong :title="row.label">{{ row.label }}</strong>
          <span v-if="row.detail" :title="row.detail">{{ row.detail }}</span>
        </div>
        <small v-if="row.meta" :class="row.tone ? `dca-tool-row-${row.tone}` : undefined">{{ row.meta }}</small>
      </div>
    </div>

    <button v-if="presentation.expandable" class="dca-tool-expand" type="button" @click="expanded = !expanded">
      <span>{{ expanded ? '收起内容' : '展开更多' }}</span>
      <i :class="expanded ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'" aria-hidden="true"></i>
    </button>

    <section v-if="rawOpen" class="dca-tool-raw-panel">
      <header>
        <div class="dca-tool-raw-tabs" role="tablist" aria-label="原始工具数据">
          <button
            v-if="presentation.rawInput"
            type="button"
            role="tab"
            :aria-selected="rawTab === 'input'"
            :class="{ active: rawTab === 'input' }"
            @click="rawTab = 'input'"
          >
            输入
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="rawTab === 'output'"
            :class="{ active: rawTab === 'output' }"
            @click="rawTab = 'output'"
          >
            输出
          </button>
        </div>
        <button class="dca-tool-copy" type="button" :title="copyLabel" @click="copyRaw">
          <i :class="copied ? 'fa-solid fa-check' : 'fa-regular fa-copy'" aria-hidden="true"></i>
          <span>{{ copyLabel }}</span>
        </button>
      </header>
      <pre class="dca-tool-content-scroll" tabindex="0">{{ activeRaw }}</pre>
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SessionUiItem } from '../../../../core/session/types';
import { buildToolPresentation } from '../../../composables/tool-presentation';
import { toolStatusLabel } from '../../../composables/timeline';

const props = defineProps<{ tool: SessionUiItem }>();

const copied = ref(false);
const expanded = ref(false);
const rawOpen = ref(false);
const rawTab = ref<'input' | 'output'>(props.tool.toolInput ? 'input' : 'output');
const presentation = computed(() => buildToolPresentation(props.tool));
const previewLines = computed(() => presentation.value.preview?.content.split(/\r?\n/u) ?? []);
const activeRaw = computed(() =>
  rawTab.value === 'input' ? presentation.value.rawInput || '没有输入参数' : presentation.value.rawOutput,
);
const copyLabel = computed(() => (copied.value ? '已复制' : '复制'));
const statusIcon = computed(() => {
  if (props.tool.status === 'running') return 'fa-solid fa-spinner fa-spin';
  if (props.tool.status === 'failed') return 'fa-solid fa-circle-xmark';
  return 'fa-solid fa-circle-check';
});

function diffLineClass(line: string): string | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'dca-tool-diff-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'dca-tool-diff-delete';
  if (line.startsWith('@@')) return 'dca-tool-diff-range';
  return undefined;
}

async function copyRaw(): Promise<void> {
  try {
    await navigator.clipboard.writeText(activeRaw.value);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1_500);
  } catch {
    copied.value = false;
  }
}
</script>

<style lang="scss">
.dca-tool-result-card {
  --dca-tool-tone: var(--dca-accent);

  position: relative;
  min-width: 0;
  border: 1px solid var(--dca-border);
  border-radius: 0.5rem;
  padding: 0.65rem;
  overflow: hidden;
  background: color-mix(in srgb, var(--dca-surface) 88%, var(--dca-canvas));
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--dca-tool-tone) 75%, transparent);
}

.dca-tool-result-success {
  --dca-tool-tone: var(--dca-success);
}

.dca-tool-result-danger,
.dca-tool-result-failed {
  --dca-tool-tone: var(--dca-danger);
}

.dca-tool-result-info {
  --dca-tool-tone: var(--dca-info);
}

.dca-tool-result-warning {
  --dca-tool-tone: var(--dca-warning);
}

.dca-tool-result-running {
  box-shadow:
    inset 2px 0 0 var(--dca-tool-tone),
    inset 0 1px 0 color-mix(in srgb, var(--dca-tool-tone) 12%, transparent);
}

.dca-tool-result-header {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.5rem;
}

.dca-tool-result-icon {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 0.42rem;
  background: color-mix(in srgb, var(--dca-tool-tone) 13%, transparent);
  color: var(--dca-tool-tone);
  font-size: 0.82rem;
}

.dca-tool-result-heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.5rem;
}

.dca-tool-result-heading strong {
  flex: 0 0 auto;
  color: var(--dca-text);
  font-size: 0.82rem;
}

.dca-tool-result-heading span {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-tool-result-status {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.68rem;
  white-space: nowrap;
}

.dca-tool-result-status.dca-tool-completed {
  color: var(--dca-success);
}

.dca-app .dca-tool-raw-toggle,
.dca-app .dca-tool-copy,
.dca-app .dca-tool-expand,
.dca-app .dca-tool-raw-tabs button {
  border: 0;
  background: transparent;
  color: var(--dca-text-muted);
  font: inherit;
  cursor: pointer;
}

.dca-app .dca-tool-raw-toggle {
  display: inline-flex;
  min-height: 1.65rem;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--dca-border);
  border-radius: 0.38rem;
  padding: 0.2rem 0.42rem;
  font-size: 0.68rem;
}

.dca-app .dca-tool-raw-toggle:hover:not(:disabled),
.dca-app .dca-tool-copy:hover:not(:disabled),
.dca-app .dca-tool-expand:hover:not(:disabled),
.dca-app .dca-tool-raw-tabs button:hover:not(:disabled) {
  background: transparent;
  color: var(--dca-text);
}

.dca-tool-result-path {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.45rem;
  color: var(--dca-text-muted);
  font-size: 0.7rem;
}

.dca-tool-result-path code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-tool-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.45rem;
}

.dca-tool-metric {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  border: 1px solid var(--dca-border);
  border-radius: 0.35rem;
  padding: 0.18rem 0.4rem;
  background: var(--dca-canvas);
  color: var(--dca-text-secondary);
  font-size: 0.68rem;
}

.dca-tool-metric small {
  color: var(--dca-text-muted);
}

.dca-tool-metric-success strong,
.dca-tool-row-success {
  color: var(--dca-success);
}

.dca-tool-metric-danger strong,
.dca-tool-row-danger {
  color: var(--dca-danger);
}

.dca-tool-metric-warning strong,
.dca-tool-row-warning {
  color: var(--dca-warning);
}

.dca-tool-content-scroll {
  scrollbar-color: color-mix(in srgb, var(--dca-text-muted) 45%, transparent) transparent;
  scrollbar-width: thin;
}

.dca-tool-preview,
.dca-tool-result-rows {
  max-height: 6.4rem;
  margin-top: 0.45rem;
  overflow: auto;
  border: 1px solid var(--dca-border);
  border-radius: 0.35rem;
  background: color-mix(in srgb, var(--dca-canvas) 82%, transparent);
}

.dca-tool-preview.expanded,
.dca-tool-result-rows.expanded {
  max-height: 16rem;
}

.dca-app details .dca-tool-preview > pre,
.dca-tool-diff {
  display: block;
  width: max-content;
  min-width: 100%;
  max-height: none;
  margin: 0;
  padding: 0.45rem 0.55rem;
  overflow: visible;
  color: var(--dca-text-secondary);
  font: 11.5px/1.5 var(--dca-font-mono);
  white-space: pre;
  word-break: normal;
}

.dca-app details .dca-tool-preview-text > pre {
  width: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dca-tool-diff > span {
  display: block;
  min-height: 1.5em;
  margin: 0 -0.55rem;
  padding: 0 0.55rem;
}

.dca-tool-diff-add {
  background: color-mix(in srgb, var(--dca-success) 10%, transparent);
  color: color-mix(in srgb, var(--dca-success) 78%, var(--dca-text));
}

.dca-tool-diff-delete {
  background: color-mix(in srgb, var(--dca-danger) 10%, transparent);
  color: color-mix(in srgb, var(--dca-danger) 74%, var(--dca-text));
}

.dca-tool-diff-range {
  color: var(--dca-info);
}

.dca-tool-result-row {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  min-height: 1.75rem;
  padding: 0.3rem 0.45rem;
  color: var(--dca-text-muted);
  font-size: 0.7rem;
}

.dca-tool-result-row + .dca-tool-result-row {
  border-top: 1px solid color-mix(in srgb, var(--dca-border) 72%, transparent);
}

.dca-tool-result-row > i {
  width: 0.9rem;
  color: var(--dca-tool-tone);
  text-align: center;
}

.dca-tool-result-row > div {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.45rem;
}

.dca-tool-result-row strong,
.dca-tool-result-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-tool-result-row strong {
  color: var(--dca-text-secondary);
  font-weight: 550;
}

.dca-tool-result-row span,
.dca-tool-result-row > small {
  color: var(--dca-text-muted);
}

.dca-app .dca-tool-expand {
  display: flex;
  width: 100%;
  min-height: 1.35rem;
  justify-content: flex-end;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0 0;
  font-size: 0.68rem;
}

.dca-tool-raw-panel {
  margin-top: 0.5rem;
  overflow: hidden;
  border: 1px solid var(--dca-border);
  border-radius: 0.4rem;
  background: var(--dca-canvas);
}

.dca-tool-raw-panel > header {
  display: flex;
  min-height: 1.8rem;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--dca-border);
  padding: 0 0.35rem;
}

.dca-tool-raw-tabs {
  display: flex;
  align-self: stretch;
  gap: 0.1rem;
}

.dca-app .dca-tool-raw-tabs button {
  min-height: 1.75rem;
  position: relative;
  padding: 0.25rem 0.45rem;
  font-size: 0.68rem;
}

.dca-app .dca-tool-raw-tabs button.active {
  color: var(--dca-text);
}

.dca-app .dca-tool-raw-tabs button.active::after {
  position: absolute;
  right: 0.35rem;
  bottom: 0;
  left: 0.35rem;
  height: 1px;
  background: var(--dca-accent);
  content: '';
}

.dca-app .dca-tool-copy {
  min-height: 1.6rem;
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.25rem 0.4rem;
  font-size: 0.66rem;
}

.dca-app details .dca-tool-raw-panel > pre {
  max-height: 11rem;
  margin: 0;
  padding: 0.5rem;
  overflow: auto;
  color: var(--dca-text-muted);
  font: 11px/1.5 var(--dca-font-mono);
  white-space: pre;
}

@media (max-width: 640px) {
  .dca-tool-result-card {
    padding: 0.55rem;
  }

  .dca-tool-result-header {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .dca-tool-result-status {
    display: none;
  }

  .dca-tool-raw-toggle span {
    display: none;
  }

  .dca-tool-preview,
  .dca-tool-result-rows {
    max-height: 5.5rem;
  }
}
</style>
