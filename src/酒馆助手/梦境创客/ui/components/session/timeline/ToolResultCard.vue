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

    <section
      v-if="presentation.webAction?.type === 'search' && presentation.webAction.queries?.length"
      class="dca-web-action dca-web-action-search"
    >
      <header>
        <span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>搜索查询</span>
        <small>{{ presentation.webAction.queries.length }} 项</small>
      </header>
      <div class="dca-web-query-list">
        <span v-for="(query, index) in presentation.webAction.queries" :key="`${index}:${query}`">
          <small>{{ index + 1 }}</small>{{ query }}
        </span>
      </div>
      <p v-if="!presentation.webAction.resultsReturned">
        <i class="fa-regular fa-circle-info" aria-hidden="true"></i>
        服务端未向界面返回来源明细
      </p>
    </section>

    <section v-if="presentation.webAction?.type === 'open'" class="dca-web-action dca-web-action-open">
      <header>
        <span><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>目标网页</span>
        <small>{{ presentation.webAction.contentPreview ? '正文已返回' : '已交给模型阅读' }}</small>
      </header>
      <a
        v-if="presentation.webAction.target"
        class="dca-web-target"
        :href="presentation.webAction.target.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="dca-web-search-favicon" aria-hidden="true">
          <i class="fa-solid fa-globe"></i>
          <img
            :src="faviconUrl(presentation.webAction.target)"
            :data-fallback="presentation.webAction.target.faviconFallbackUrl"
            alt=""
            decoding="async"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="handleFaviconError"
          />
        </span>
        <span>
          <strong>{{ presentation.webAction.target.domain }}</strong>
          <small>{{ presentation.webAction.target.displayUrl }}</small>
        </span>
        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
      </a>
      <p v-if="presentation.webAction.contentPreview" class="dca-web-content-preview">
        {{ presentation.webAction.contentPreview }}
      </p>
    </section>

    <section v-if="presentation.webAction?.type === 'find'" class="dca-web-action dca-web-action-find">
      <header>
        <span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>页内关键词</span>
        <small>
          {{
            presentation.webAction.totalMatches === undefined
              ? '结果明细未返回'
              : `${presentation.webAction.totalMatches} 处匹配`
          }}
        </small>
      </header>
      <strong class="dca-web-find-pattern">{{ presentation.webAction.pattern }}</strong>
      <a
        v-if="presentation.webAction.target"
        class="dca-web-target dca-web-target-compact"
        :href="presentation.webAction.target.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="dca-web-search-favicon" aria-hidden="true">
          <i class="fa-solid fa-globe"></i>
          <img
            :src="faviconUrl(presentation.webAction.target)"
            :data-fallback="presentation.webAction.target.faviconFallbackUrl"
            alt=""
            decoding="async"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="handleFaviconError"
          />
        </span>
        <span><strong>{{ presentation.webAction.target.domain }}</strong><small>{{ presentation.webAction.target.displayUrl }}</small></span>
      </a>
      <ol v-if="presentation.webAction.matches?.length" class="dca-web-find-matches">
        <li v-for="(match, index) in presentation.webAction.matches" :key="`${index}:${match}`">{{ match }}</li>
      </ol>
    </section>

    <section v-if="presentation.webSearch" class="dca-web-search-results">
      <section v-for="(group, groupIndex) in visibleWebSearchGroups" :key="`${groupIndex}:${group.query ?? ''}`">
        <header class="dca-web-search-query">
          <span>
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <strong>{{ group.query ?? '网页搜索' }}</strong>
          </span>
          <small>找到 {{ group.results.length }} 条结果</small>
        </header>
        <ol class="dca-web-search-list">
          <li v-for="(result, resultIndex) in group.results" :key="`${resultIndex}:${result.url ?? result.title}`">
            <span class="dca-web-search-index">{{ resultIndex + 1 }}</span>
            <span class="dca-web-search-favicon" aria-hidden="true">
              <i class="fa-solid fa-globe"></i>
              <img
                v-if="result.faviconDarkUrl || result.faviconLightUrl"
                :src="faviconUrl(result)"
                :data-fallback="result.faviconFallbackUrl"
                alt=""
                decoding="async"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="handleFaviconError"
              />
            </span>
            <div class="dca-web-search-result-main">
              <div class="dca-web-search-result-title">
                <a
                  v-if="result.url"
                  :href="result.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="result.title"
                >
                  {{ result.title }}
                </a>
                <strong v-else :title="result.title">{{ result.title }}</strong>
                <small v-if="result.domain">{{ result.domain }}</small>
              </div>
              <p v-if="result.snippet" :title="result.snippet">{{ result.snippet }}</p>
            </div>
            <time v-if="result.publishDate">{{ compactDate(result.publishDate) }}</time>
          </li>
        </ol>
      </section>
    </section>

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
      <span>{{ expandLabel }}</span>
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

    <section
      v-if="confirmation"
      class="dca-tool-confirmation-panel"
      :class="{ 'dca-tool-confirmation-high-risk': confirmation.risk === 'high' }"
    >
      <header>
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div>
          <strong>{{ confirmation.risk === 'high' ? '需要批准高风险操作' : 'Agent 请求执行此工具' }}</strong>
          <span>Agent 已暂停，等待你的决定</span>
        </div>
      </header>
      <p>{{ confirmation.description }}</p>
      <pre v-if="formattedIntent" class="dca-tool-confirmation-intent">{{ formattedIntent }}</pre>
      <footer>
        <button type="button" @click="emit('resolve-confirmation', false)">拒绝</button>
        <button
          :class="confirmation.risk === 'high' ? 'danger' : 'primary'"
          type="button"
          @click="emit('resolve-confirmation', true)"
        >
          批准并执行
        </button>
      </footer>
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { ToolConfirmation } from '../../../../core/runner/tools';
import type { SessionUiItem } from '../../../../core/session/types';
import {
  buildToolPresentation,
  type ToolWebSearchResult,
  type ToolWebTarget,
} from '../../../composables/tool-presentation';
import type { ActiveThemeDetail } from '../../../theme/runtime';
import { toolStatusLabel } from '../../../composables/timeline';

const props = defineProps<{ confirmation?: ToolConfirmation; tool: SessionUiItem }>();
const emit = defineEmits<{ 'resolve-confirmation': [approved: boolean] }>();

const copied = ref(false);
const expanded = ref(false);
const rawOpen = ref(false);
const rawTab = ref<'input' | 'output'>(props.tool.toolInput ? 'input' : 'output');
const colorScheme = ref<'dark' | 'light'>('dark');
const presentation = computed(() => buildToolPresentation(props.tool));
const previewLines = computed(() => presentation.value.preview?.content.split(/\r?\n/u) ?? []);
const visibleWebSearchGroups = computed(() =>
  (presentation.value.webSearch?.groups ?? []).map(group => ({
    ...group,
    results: expanded.value ? group.results : group.results.slice(0, 3),
  })),
);
const hiddenWebSearchResults = computed(() =>
  (presentation.value.webSearch?.groups ?? []).reduce((total, group) => total + Math.max(0, group.results.length - 3), 0),
);
const expandLabel = computed(() => {
  if (expanded.value) return '收起内容';
  return presentation.value.webSearch && hiddenWebSearchResults.value > 0
    ? `展开其余 ${hiddenWebSearchResults.value} 条`
    : '展开更多';
});
const formattedIntent = computed(() => {
  if (props.confirmation?.intent === undefined) return '';
  try {
    return JSON.stringify(props.confirmation.intent, null, 2);
  } catch {
    return String(props.confirmation.intent);
  }
});
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

function compactDate(value: string): string {
  return value.match(/\d{4}-\d{2}-\d{2}/u)?.[0] ?? value;
}

function faviconUrl(target: ToolWebSearchResult | ToolWebTarget): string {
  return colorScheme.value === 'dark'
    ? (target.faviconDarkUrl ?? target.faviconLightUrl ?? '')
    : (target.faviconLightUrl ?? target.faviconDarkUrl ?? '');
}

function handleFaviconError(event: Event): void {
  if (!(event.currentTarget instanceof HTMLImageElement)) return;
  const image = event.currentTarget;
  const fallback = image.dataset.fallback;
  if (fallback && image.src !== fallback) {
    image.src = fallback;
    return;
  }
  image.hidden = true;
}

function detectColorScheme(): 'dark' | 'light' {
  return document.querySelector<HTMLElement>('.dca-app')?.dataset.dcaColorScheme === 'light' ? 'light' : 'dark';
}

function onThemeChange(event: Event): void {
  const detail = (event as CustomEvent<ActiveThemeDetail>).detail;
  colorScheme.value = detail?.colorScheme === 'light' ? 'light' : 'dark';
}

onMounted(() => {
  colorScheme.value = detectColorScheme();
  window.addEventListener('dca-theme-change', onThemeChange);
});

onUnmounted(() => window.removeEventListener('dca-theme-change', onThemeChange));

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

.dca-web-search-results {
  margin-top: 0.45rem;
  overflow: hidden;
  border: 1px solid var(--dca-border);
  border-radius: 0.4rem;
  background: color-mix(in srgb, var(--dca-canvas) 82%, transparent);
}

.dca-web-action {
  margin-top: 0.45rem;
  overflow: hidden;
  border: 1px solid var(--dca-border);
  border-radius: 0.4rem;
  background: color-mix(in srgb, var(--dca-canvas) 82%, transparent);
}

.dca-web-action > header {
  display: flex;
  min-height: 2rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid color-mix(in srgb, var(--dca-border) 78%, transparent);
  background: color-mix(in srgb, var(--dca-surface) 72%, transparent);
}

.dca-web-action > header > span {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  color: var(--dca-text-secondary);
  font-size: 0.72rem;
  font-weight: 550;
}

.dca-web-action > header i,
.dca-web-action > p > i {
  color: var(--dca-tool-tone);
}

.dca-web-action > header > small,
.dca-web-action > p {
  color: var(--dca-text-muted);
  font-size: 0.65rem;
}

.dca-web-action > p {
  margin: 0;
  padding: 0.42rem 0.55rem;
}

.dca-web-query-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.32rem;
  padding: 0.5rem 0.55rem;
}

.dca-web-query-list > span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid color-mix(in srgb, var(--dca-tool-tone) 24%, var(--dca-border));
  border-radius: 999px;
  padding: 0.2rem 0.45rem 0.2rem 0.25rem;
  background: color-mix(in srgb, var(--dca-tool-tone) 7%, transparent);
  color: var(--dca-text-secondary);
  font-size: 0.68rem;
}

.dca-web-query-list small {
  display: grid;
  width: 1rem;
  height: 1rem;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dca-tool-tone) 14%, transparent);
  color: var(--dca-tool-tone);
  font: 9px/1 var(--dca-font-mono);
}

.dca-web-target {
  display: grid;
  min-width: 0;
  grid-template-columns: 1.35rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.55rem;
  color: var(--dca-text);
  text-decoration: none;
}

.dca-web-target:hover {
  background: color-mix(in srgb, var(--dca-tool-tone) 6%, transparent);
}

.dca-web-target > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 0.08rem;
}

.dca-web-target strong,
.dca-web-target small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-web-target strong {
  font-size: 0.72rem;
}

.dca-web-target small,
.dca-web-target > i {
  color: var(--dca-text-muted);
  font-size: 0.63rem;
}

.dca-web-target-compact {
  border-top: 1px solid color-mix(in srgb, var(--dca-border) 65%, transparent);
}

.dca-web-find-pattern {
  display: block;
  padding: 0.5rem 0.55rem;
  color: var(--dca-text);
  font: 0.72rem/1.4 var(--dca-font-mono);
}

.dca-web-find-matches {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--dca-border);
  list-style: none;
}

.dca-web-find-matches li {
  padding: 0.4rem 0.55rem;
  color: var(--dca-text-muted);
  font-size: 0.67rem;
}

.dca-web-find-matches li + li {
  border-top: 1px solid color-mix(in srgb, var(--dca-border) 65%, transparent);
}

.dca-web-content-preview {
  display: -webkit-box;
  overflow: hidden;
  border-top: 1px solid var(--dca-border);
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.dca-web-search-results > section + section {
  border-top: 1px solid var(--dca-border);
}

.dca-web-search-query {
  display: flex;
  min-height: 2rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid color-mix(in srgb, var(--dca-border) 78%, transparent);
  background: color-mix(in srgb, var(--dca-surface) 72%, transparent);
}

.dca-web-search-query > span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.4rem;
}

.dca-web-search-query i {
  color: var(--dca-tool-tone);
  font-size: 0.7rem;
}

.dca-web-search-query strong {
  overflow: hidden;
  color: var(--dca-text-secondary);
  font-size: 0.72rem;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-web-search-query small {
  flex: 0 0 auto;
  color: var(--dca-text-muted);
  font-size: 0.66rem;
}

.dca-web-search-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dca-web-search-list > li {
  display: grid;
  min-width: 0;
  grid-template-columns: 1.15rem 1.15rem minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.42rem;
  padding: 0.48rem 0.55rem;
}

.dca-web-search-list > li + li {
  border-top: 1px solid color-mix(in srgb, var(--dca-border) 70%, transparent);
}

.dca-web-search-index {
  display: grid;
  width: 1.15rem;
  height: 1.15rem;
  place-items: center;
  border-radius: 0.3rem;
  background: color-mix(in srgb, var(--dca-tool-tone) 10%, transparent);
  color: var(--dca-text-muted);
  font: 10px/1 var(--dca-font-mono);
}

.dca-web-search-favicon {
  position: relative;
  display: grid;
  width: 1.15rem;
  height: 1.15rem;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dca-text) 10%, transparent);
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--dca-text) 5%, transparent);
  color: var(--dca-tool-tone);
  font-size: 0.68rem;
}

.dca-web-search-favicon img {
  position: absolute;
  inset: 0.08rem;
  width: calc(100% - 0.16rem);
  height: calc(100% - 0.16rem);
  border-radius: 0.16rem;
  background: transparent;
  object-fit: contain;
}

.dca-web-search-result-main {
  min-width: 0;
}

.dca-web-search-result-title {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.45rem;
}

.dca-web-search-result-title > a,
.dca-web-search-result-title > strong {
  overflow: hidden;
  color: var(--dca-text);
  font-size: 0.72rem;
  font-weight: 550;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-web-search-result-title > a:hover {
  color: var(--dca-info);
  text-decoration: underline;
  text-underline-offset: 0.15rem;
}

.dca-web-search-result-title > small {
  overflow: hidden;
  flex: 0 1 auto;
  color: var(--dca-text-muted);
  font-size: 0.64rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-web-search-result-main > p {
  display: -webkit-box;
  margin: 0.22rem 0 0;
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.67rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.dca-web-search-list time {
  padding-top: 0.05rem;
  color: var(--dca-text-muted);
  font: 10px/1.4 var(--dca-font-mono);
  white-space: nowrap;
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

.dca-tool-confirmation-panel {
  margin: 0.6rem -0.65rem -0.65rem;
  border-top: 1px solid color-mix(in srgb, var(--dca-warning) 42%, var(--dca-border));
  padding: 0.65rem;
  background: var(--dca-warning-soft);
}

.dca-tool-confirmation-panel > header {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.dca-tool-confirmation-panel > header > i {
  color: var(--dca-warning);
}

.dca-tool-confirmation-panel > header > div {
  display: grid;
  gap: 0.1rem;
}

.dca-tool-confirmation-panel > header strong {
  color: var(--dca-text);
  font-size: 0.78rem;
}

.dca-tool-confirmation-panel > header span,
.dca-tool-confirmation-panel > p {
  color: var(--dca-text-muted);
  font-size: 0.7rem;
}

.dca-tool-confirmation-panel > p {
  margin: 0.5rem 0 0;
}

.dca-app details .dca-tool-confirmation-intent {
  max-height: 8rem;
  margin: 0.5rem 0 0;
  padding: 0.45rem 0.55rem;
  overflow: auto;
  border: 1px solid var(--dca-border);
  border-radius: var(--dca-radius-sm);
  background: color-mix(in srgb, var(--dca-canvas) 82%, transparent);
  color: var(--dca-text-secondary);
  font: 11px/1.5 var(--dca-font-mono);
  white-space: pre-wrap;
}

.dca-tool-confirmation-panel > footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  margin-top: 0.6rem;
}

.dca-tool-confirmation-high-risk {
  border-top-color: color-mix(in srgb, var(--dca-danger) 48%, var(--dca-border));
  background: var(--dca-danger-soft);
}

.dca-tool-confirmation-high-risk > header > i {
  color: var(--dca-danger);
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

  .dca-tool-confirmation-panel {
    margin: 0.55rem -0.55rem -0.55rem;
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

  .dca-web-search-list > li {
    grid-template-columns: 1.1rem 1.1rem minmax(0, 1fr);
    padding: 0.45rem;
  }

  .dca-web-search-list time {
    display: none;
  }

  .dca-web-search-result-title {
    display: grid;
    gap: 0.08rem;
  }
}
</style>
