<template>
  <div class="preset-adapter-root">
    <header class="preset-adapter-header">
      <div>
        <h3>{{ store.title }}</h3>
        <p v-if="store.description" class="preset-adapter-description">{{ store.description }}</p>
        <span class="preset-adapter-preset">当前预设：{{ store.loaded_preset_name }}</span>
      </div>
      <button type="button" class="menu_button preset-adapter-icon-button" title="刷新" @click="store.refresh()">
        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
      </button>
    </header>

    <nav v-if="store.debug_available" class="preset-adapter-tabs" aria-label="梦鲸思客设置页签">
      <button
        type="button"
        class="preset-adapter-tab"
        :class="{ 'preset-adapter-tab-active': store.active_tab === 'preset' }"
        @click="store.setActiveTab('preset')"
      >
        预设修改
      </button>
      <button
        type="button"
        class="preset-adapter-tab"
        :class="{ 'preset-adapter-tab-active': store.active_tab === 'debug' }"
        @click="store.setActiveTab('debug')"
      >
        Debug
        <span v-if="store.debug_records.length > 0">{{ store.debug_records.length }}</span>
      </button>
    </nav>

    <template v-if="store.active_tab === 'preset'">
      <div class="preset-adapter-stats">
        <span>{{ store.groups.length }} 组</span>
        <span>{{ option_count }} 个选项</span>
      </div>

      <div class="preset-adapter-actions">
        <template v-if="store.export_mode">
          <span class="preset-adapter-selection-count">已选 {{ store.selected_export_count }} 项</span>
          <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.exportSelectedOptions()">
            导出
          </button>
          <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.cancelExportMode()">
            取消
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="menu_button"
            :disabled="store.is_applying || store.has_blocking_errors"
            @click="openImportFilePicker()"
          >
            导入
          </button>
          <button
            type="button"
            class="menu_button"
            :disabled="store.is_applying || store.has_blocking_errors"
            @click="store.startExportMode()"
          >
            导出
          </button>
        </template>
        <input ref="import_file_input" type="file" accept="application/json,.json" hidden @change="importPresetSettings" />
      </div>

      <section v-if="store.errors.length > 0" class="preset-adapter-errors">
        <strong>配置错误</strong>
        <ul>
          <li v-for="error in store.errors" :key="error">{{ error }}</li>
        </ul>
      </section>

      <div v-if="store.groups.length === 0" class="preset-adapter-empty">未配置选项组</div>

      <section v-for="group in store.groups" :key="group.id" class="preset-adapter-group">
        <div class="preset-adapter-group-header">
          <div class="preset-adapter-group-title">
            <h4>{{ group.label }}</h4>
            <p v-if="group.description" class="preset-adapter-description">{{ group.description }}</p>
          </div>
          <span>{{ group.mode_label }}</span>
        </div>

        <div class="preset-adapter-options" :class="`preset-adapter-options-${group.layout}`">
          <button
            v-for="option in group.options"
            :key="option.id"
            type="button"
            class="preset-adapter-option"
            :class="[
              `preset-adapter-option-${option.status}`,
              {
                'preset-adapter-option-export-mode': store.export_mode,
                'preset-adapter-option-export-selected': store.isExportOptionSelected(group.id, option.id),
                'preset-adapter-option-export-unavailable': store.export_mode && !option.exportable,
              },
            ]"
            :disabled="store.is_applying || store.has_blocking_errors || (!store.export_mode && option.status === 'unmatched')"
            :title="option.matched_summary"
            @click="handleOptionClick(group.id, option.id)"
          >
            <span class="preset-adapter-option-main">
              <i :class="option.status_icon_class" aria-hidden="true"></i>
              <span class="preset-adapter-option-title">
                <span>{{ option.label }}</span>
                <small v-if="option.description">{{ option.description }}</small>
              </span>
            </span>
          </button>
        </div>
      </section>
    </template>

    <section v-else class="preset-adapter-debug">
      <div class="preset-adapter-debug-layout">
        <aside class="preset-adapter-debug-records">
          <header class="preset-adapter-debug-pane-header">
            <div>
              <h4>Debug 记录</h4>
              <p class="preset-adapter-description">保留最新 {{ store.debug_records.length }} / 50 条</p>
            </div>
            <button
              type="button"
              class="menu_button"
              :disabled="store.debug_records.length === 0"
              @click="store.clearDebugRecords()"
            >
              清空
            </button>
          </header>

          <div v-if="store.debug_records.length === 0" class="preset-adapter-empty">暂无 Debug 信息</div>
          <div v-else class="preset-adapter-debug-record-list">
            <button
              v-for="record in store.debug_records"
              :key="record.id"
              type="button"
              class="preset-adapter-debug-record"
              :class="{ 'preset-adapter-debug-record-active': record.id === store.selected_debug_record_id }"
              @click="store.selectDebugRecord(record.id)"
            >
              <strong>{{ record.title }}</strong>
              <small>{{ formatDebugTime(record.created_at) }}</small>
              <span class="preset-adapter-debug-record-summary">
                总排序 {{ record.summary.total_rows }} · 触发 {{ record.summary.triggered_rows }} · 错误 {{ record.summary.error_count }}
              </span>
            </button>
          </div>
        </aside>

        <section class="preset-adapter-debug-detail">
          <template v-if="selected_debug_record">
            <header class="preset-adapter-debug-pane-header">
              <div>
                <h4>{{ selected_debug_record.title }}</h4>
                <p class="preset-adapter-description">{{ formatDebugTime(selected_debug_record.created_at) }}</p>
              </div>
              <button type="button" class="menu_button" @click="openDebugRawModal()">原始数据</button>
            </header>

            <div class="preset-adapter-debug-metrics">
              <span v-for="metric in getDebugMetrics(selected_debug_record)" :key="metric.label">
                {{ metric.label }} {{ metric.value }}
              </span>
            </div>

            <section class="preset-adapter-debug-section">
              <h4>总排序</h4>
              <div v-if="debug_total_rows.length === 0" class="preset-adapter-empty">无总排序信息</div>
              <details v-for="entry in debug_total_rows" :key="entry.key" class="preset-adapter-debug-row">
                <summary>{{ getDebugTotalSummary(entry.row) }}</summary>
                <dl>
                  <template v-for="field in getDebugRowFields(entry.row)" :key="field.key">
                    <dt>{{ field.key }}</dt>
                    <dd>
                      <template v-if="field.key === '详细内容'">
                        <span>{{ field.preview }}</span>
                        <button type="button" class="menu_button" @click="openDebugRowContentModal('总排序 - 详细内容', entry.row)">
                          详情
                        </button>
                      </template>
                      <template v-else>{{ field.text }}</template>
                    </dd>
                  </template>
                </dl>
              </details>
            </section>

            <section class="preset-adapter-debug-section">
              <h4>触发蓝灯绿灯</h4>
              <div v-if="debug_triggered_rows.length === 0" class="preset-adapter-empty">无触发信息</div>
              <details v-for="entry in debug_triggered_rows" :key="entry.key" class="preset-adapter-debug-row">
                <summary>{{ getDebugTriggeredSummary(entry.row) }}</summary>
                <dl>
                  <template v-for="field in getDebugRowFields(entry.row)" :key="field.key">
                    <dt>{{ field.key }}</dt>
                    <dd>
                      <template v-if="field.key === '详细内容'">
                        <span>{{ field.preview }}</span>
                        <button
                          type="button"
                          class="menu_button"
                          @click="openDebugRowContentModal('触发蓝灯绿灯 - 详细内容', entry.row)"
                        >
                          详情
                        </button>
                      </template>
                      <template v-else>{{ field.text }}</template>
                    </dd>
                  </template>
                </dl>
              </details>
            </section>

            <section class="preset-adapter-debug-section">
              <h4>错误信息</h4>
              <textarea
                class="preset-adapter-debug-error-text"
                readonly
                :value="debug_error_text || '无错误信息'"
              ></textarea>
            </section>
          </template>
          <div v-else class="preset-adapter-empty">请选择一条 Debug 记录</div>
        </section>
      </div>
    </section>

    <div v-if="debug_text_modal" class="preset-adapter-review-backdrop" @click.self="closeDebugTextModal()">
      <section class="preset-adapter-debug-text-panel" role="dialog" aria-modal="true">
        <header class="preset-adapter-review-header">
          <h3>{{ debug_text_modal.title }}</h3>
          <button
            type="button"
            class="menu_button preset-adapter-icon-button"
            title="关闭"
            @click="closeDebugTextModal()"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>
        <textarea class="preset-adapter-debug-large-text" readonly :value="debug_text_modal.content"></textarea>
      </section>
    </div>

    <div v-if="store.review_panel" class="preset-adapter-review-backdrop" @click.self="store.closeReviewPanel()">
      <section class="preset-adapter-review-panel" role="dialog" aria-modal="true">
        <header class="preset-adapter-review-header">
          <div>
            <h3>{{ store.review_panel.title }}</h3>
            <p v-if="store.review_panel.kind === 'export'" class="preset-adapter-description">
              文件名：{{ store.review_panel.filename }}
            </p>
            <p v-else class="preset-adapter-description">
              匹配成功 {{ store.review_panel.items.length }} 项，匹配失败 {{ store.review_panel.failed_items.length }} 项。导入后会自动保存当前预设，所有导入项默认关闭。
            </p>
          </div>
          <button
            type="button"
            class="menu_button preset-adapter-icon-button"
            title="关闭"
            :disabled="store.is_applying"
            @click="store.closeReviewPanel()"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>

        <div class="preset-adapter-review-body">
          <section
            v-if="store.review_panel.kind === 'import' && store.review_panel.failed_items.length > 0"
            class="preset-adapter-review-section"
          >
            <h4>匹配失败</h4>
            <article
              v-for="item in store.review_panel.failed_items"
              :key="item.key"
              class="preset-adapter-review-item preset-adapter-review-item-failed"
            >
              <div class="preset-adapter-review-item-main">
                <span class="preset-adapter-review-badge preset-adapter-review-badge-failed">匹配失败</span>
                <span class="preset-adapter-review-badge preset-adapter-review-badge-append">{{ item.action_label }}</span>
                <strong>{{ item.name }}</strong>
              </div>
              <p>{{ item.group_id }} / {{ item.match_id }}</p>
              <p>{{ item.issue }}</p>
              <details>
                <summary>内容预览</summary>
                <pre>{{ item.preview }}</pre>
              </details>
            </article>
          </section>

          <section class="preset-adapter-review-section">
            <h4>{{ store.review_panel.kind === 'export' ? '将要导出' : '将要导入' }}</h4>
            <div v-if="store.review_panel.items.length === 0" class="preset-adapter-empty">没有匹配成功的设置</div>
            <article v-for="item in store.review_panel.items" :key="item.key" class="preset-adapter-review-item">
              <div class="preset-adapter-review-item-main">
                <span
                  class="preset-adapter-review-badge"
                  :class="`preset-adapter-review-badge-${item.action}`"
                >
                  {{ item.action_label }}
                </span>
                <strong>{{ item.name }}</strong>
              </div>
              <p>{{ item.group_label }} · {{ item.group_id }} / {{ item.match_id }}</p>
              <details>
                <summary>内容预览</summary>
                <pre>{{ item.preview }}</pre>
              </details>
            </article>
          </section>
        </div>

        <footer class="preset-adapter-review-footer">
          <template v-if="store.review_panel.kind === 'export'">
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.confirmExportReview()">
              导出
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.closeReviewPanel()">
              取消
            </button>
          </template>
          <template v-else-if="store.review_panel.failed_items.length > 0">
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmImport(true)">
              导入全部
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmImport(false)">
              仅导入匹配成功
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.closeReviewPanel()">
              取消
            </button>
          </template>
          <template v-else>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmImport(true)">
              导入
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.closeReviewPanel()">
              取消
            </button>
          </template>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePresetAdapterStore } from './store';

const store = usePresetAdapterStore();
const option_count = computed(() => store.groups.reduce((total, group) => total + group.options.length, 0));
const import_file_input = ref<HTMLInputElement>();
const debug_text_modal = ref<{ content: string; title: string }>();
const selected_debug_record = computed(() => store.selected_debug_record);
const debug_total_rows = computed(() => getDebugRows(selected_debug_record.value?.state.total_rows));
const debug_triggered_rows = computed(() => getTriggeredDebugRows(selected_debug_record.value?.state.triggered_rows));
const debug_error_text = computed(() =>
  getDebugArray(selected_debug_record.value?.state.error_logs).map(getDebugValueText).join('\n\n'),
);

type DebugRecord = NonNullable<typeof store.selected_debug_record>;
type DebugRow = Record<string, unknown>;

onMounted(() => {
  store.startDebugWatch();
});

onBeforeUnmount(() => {
  store.stopDebugWatch();
});

function openImportFilePicker() {
  import_file_input.value?.click();
}

function handleOptionClick(group_id: string, option_id: string) {
  if (store.export_mode) {
    store.toggleExportOption(group_id, option_id);
    return;
  }
  void store.applyOption(group_id, option_id);
}

async function importPresetSettings(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  await store.importPresetSettings(await file.text());
  input.value = '';
}

function confirmImport(include_failed: boolean) {
  void store.confirmImportReview(include_failed);
}

function isDebugObject(value: unknown): value is DebugRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDebugArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getDebugValueText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getDebugSummaryText(value: unknown, max_length = 96): string {
  const text = getDebugValueText(value).replace(/\s+/g, ' ').trim();
  if (!text) {
    return '空';
  }
  return text.length > max_length ? text.slice(0, max_length) : text;
}

function getDebugPreview(value: unknown, max_length = 240): string {
  const text = getDebugValueText(value);
  return text.length > max_length ? `${text.slice(0, max_length)}……` : text;
}

function getDebugRows(value: unknown): { key: string; row: DebugRow }[] {
  return getDebugArray(value).map((item, index) => ({
    key: String(index),
    row: isDebugObject(item) ? item : { 值: item },
  }));
}

function getTriggeredDebugRows(value: unknown): { key: string; row: DebugRow }[] {
  return getDebugArray(value).map((item, index) => {
    const row = isDebugObject(item) && isDebugObject(item.row) ? item.row : item;
    const key = isDebugObject(item) && typeof item.key === 'string' ? item.key : String(index);
    return {
      key,
      row: isDebugObject(row) ? row : { 值: row },
    };
  });
}

function getDebugRowFields(row: DebugRow): { key: string; preview: string; text: string }[] {
  return Object.entries(row).map(([key, value]) => ({
    key,
    preview: getDebugPreview(value),
    text: getDebugValueText(value),
  }));
}

function getDebugTotalSummary(row: DebugRow): string {
  return `${getDebugSummaryText(row.类型)} - ${getDebugSummaryText(row.来源)} - ${getDebugSummaryText(row.详细内容摘要 ?? row.详细内容)}……`;
}

function getDebugTriggeredSummary(row: DebugRow): string {
  return `${getDebugSummaryText(row.触发类型)} - ${getDebugSummaryText(row.名称)} - ${getDebugSummaryText(row.详细内容摘要 ?? row.详细内容)}……`;
}

function getDebugMetrics(record: DebugRecord): { label: string; value: number }[] {
  return [
    { label: '总排序', value: record.summary.total_rows },
    { label: '触发', value: record.summary.triggered_rows },
    { label: '错误', value: record.summary.error_count },
    { label: '失败', value: record.summary.failed },
    { label: '已载入', value: record.summary.loaded_total },
    { label: '绿灯缓存', value: record.summary.green_cache_insertions },
    { label: '残留包裹', value: record.summary.wrapper_paired + record.summary.wrapper_orphan },
  ];
}

function formatDebugTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function openDebugTextModal(title: string, content: string) {
  debug_text_modal.value = { content, title };
}

function openDebugRowContentModal(title: string, row: DebugRow) {
  const record_id = selected_debug_record.value?.id;
  const content_id = typeof row.详细内容缓存键 === 'string' ? row.详细内容缓存键 : undefined;
  const cached_content = record_id && content_id ? store.getDebugContent(record_id, content_id) : undefined;
  openDebugTextModal(title, cached_content ?? getDebugValueText(row.详细内容));
}

function openDebugRawModal() {
  if (!selected_debug_record.value) {
    return;
  }
  openDebugTextModal('原始数据', JSON.stringify(selected_debug_record.value.state, null, 2));
}

function closeDebugTextModal() {
  debug_text_modal.value = undefined;
}
</script>

<style>
.preset-adapter-floating-window {
  position: fixed;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  box-shadow: 0 12px 36px var(--black70a);
  background-color: color-mix(in srgb, var(--SmartThemeBlurTintColor) 92%, var(--black100) 8%);
  color: var(--SmartThemeBodyColor);
}

.preset-adapter-floating-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  min-height: 2.55rem;
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  padding: 0.25rem 0.4rem 0.25rem 0.75rem;
  background-color: var(--black30a);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.preset-adapter-floating-titlebar:active {
  cursor: grabbing;
}

.preset-adapter-floating-title {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 0.5rem;
  font-weight: 700;
}

.preset-adapter-floating-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-floating-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2em;
  height: 2em;
  padding: 0;
}

.preset-adapter-floating-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0.75rem;
  scrollbar-gutter: stable;
}

.preset-adapter-floating-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1.15rem;
  height: 1.15rem;
  cursor: nwse-resize;
  touch-action: none;
}

.preset-adapter-floating-resize::after {
  position: absolute;
  right: 0.25rem;
  bottom: 0.25rem;
  width: 0.55rem;
  height: 0.55rem;
  border-right: 2px solid var(--SmartThemeEmColor);
  border-bottom: 2px solid var(--SmartThemeEmColor);
  content: '';
  opacity: 0.8;
}

@media (max-width: 720px) {
  .preset-adapter-floating-body {
    padding: 0.6rem;
  }

  .preset-adapter-floating-titlebar {
    min-height: 2.4rem;
  }
}
</style>

<style scoped>
.preset-adapter-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 0.7rem;
  min-height: 0;
  color: var(--SmartThemeBodyColor);
  container-type: inline-size;
}

.preset-adapter-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.preset-adapter-header > div,
.preset-adapter-group-title {
  min-width: 0;
}

.preset-adapter-header h3,
.preset-adapter-group-header h4 {
  margin: 0;
  line-height: 1.25;
}

.preset-adapter-description {
  margin: 0.22rem 0 0;
  color: var(--SmartThemeEmColor);
  font-size: 0.88rem;
  line-height: 1.45;
}

.preset-adapter-preset {
  display: inline-block;
  margin-top: 0.35rem;
  color: var(--SmartThemeEmColor);
  font-size: 0.9rem;
}

.preset-adapter-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  padding-bottom: 0.45rem;
}

.preset-adapter-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2rem;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 6px;
  padding: 0.25rem 0.7rem;
  background-color: var(--black30a);
  color: var(--SmartThemeBodyColor);
  cursor: pointer;
  gap: 0.35rem;
}

.preset-adapter-tab:hover,
.preset-adapter-tab-active {
  border-color: var(--SmartThemeUnderlineColor);
  background-color: var(--black50a);
}

.preset-adapter-tab span {
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 999px;
  padding: 0 0.4rem;
  color: var(--SmartThemeEmColor);
  font-size: 0.78rem;
  line-height: 1.35;
}

.preset-adapter-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.preset-adapter-stats span {
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  background-color: var(--black30a);
  color: var(--SmartThemeEmColor);
  font-size: 0.85rem;
}

.preset-adapter-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.preset-adapter-actions .menu_button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 4.5rem;
  min-height: 2rem;
  padding-inline: 0.75rem;
  white-space: nowrap;
}

.preset-adapter-selection-count {
  color: var(--SmartThemeEmColor);
  font-size: 0.88rem;
}

.preset-adapter-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2em;
  height: 2em;
  padding: 0;
}

.preset-adapter-errors {
  border: 1px solid var(--SmartThemeQuoteColor);
  border-radius: 8px;
  padding: 0.75rem;
  background-color: var(--black30a);
}

.preset-adapter-errors ul {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
  white-space: pre-wrap;
}

.preset-adapter-empty {
  border: 1px dashed var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 1rem;
  color: var(--SmartThemeEmColor);
  text-align: center;
}

.preset-adapter-group {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border-top: 1px solid var(--SmartThemeBorderColor);
  padding-top: 0.75rem;
}

.preset-adapter-group-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.preset-adapter-group-header span {
  flex: 0 0 auto;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  color: var(--SmartThemeEmColor);
  font-size: 0.85rem;
}

.preset-adapter-options {
  gap: 0.5rem;
}

.preset-adapter-options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
}

.preset-adapter-options-row {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
}

.preset-adapter-options-row .preset-adapter-option {
  min-width: 0;
}

.preset-adapter-option {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.25rem 0.5rem;
  align-items: center;
  min-height: 3.55rem;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 0.55rem 0.65rem;
  background-color: var(--black30a);
  color: var(--SmartThemeBodyColor);
  text-align: left;
  cursor: pointer;
}

.preset-adapter-option:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.preset-adapter-option:not(:disabled):hover {
  border-color: var(--SmartThemeUnderlineColor);
  background-color: var(--black50a);
}

.preset-adapter-option-export-mode {
  border-style: dashed;
}

.preset-adapter-option-export-selected {
  border-color: var(--SmartThemeQuoteColor);
  box-shadow: inset 0 0 0 2px var(--SmartThemeQuoteColor);
  background-color: color-mix(in srgb, var(--SmartThemeQuoteColor) 18%, var(--black30a) 82%);
}

.preset-adapter-option-export-unavailable {
  opacity: 0.58;
}

.preset-adapter-option-main {
  display: inline-flex;
  align-items: flex-start;
  min-width: 0;
  gap: 0.45rem;
  font-weight: 700;
}

.preset-adapter-option-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.12rem;
}

.preset-adapter-option-title > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-option-title small {
  overflow: hidden;
  color: var(--SmartThemeEmColor);
  font-size: 0.8rem;
  font-weight: 400;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-option-active .preset-adapter-option-main i {
  color: var(--SmartThemeUnderlineColor);
}

.preset-adapter-option-unmatched .preset-adapter-option-main i {
  color: var(--SmartThemeEmColor);
}

.preset-adapter-options-row .preset-adapter-option {
  align-content: start;
}

.preset-adapter-review-backdrop {
  position: fixed;
  inset: 0;
  z-index: 4200;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 1rem;
  background-color: var(--black50a);
}

.preset-adapter-review-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(44rem, calc(100vw - 2rem));
  max-height: min(44rem, calc(100dvh - 2rem));
  overflow: hidden;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  box-shadow: 0 12px 36px var(--black70a);
  background-color: color-mix(in srgb, var(--SmartThemeBlurTintColor) 94%, var(--black100) 6%);
  color: var(--SmartThemeBodyColor);
}

.preset-adapter-review-header,
.preset-adapter-review-footer {
  display: flex;
  flex-wrap: wrap;
  flex: 0 0 auto;
  gap: 0.65rem;
  padding: 0.75rem;
}

.preset-adapter-review-header {
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  background-color: var(--black30a);
}

.preset-adapter-review-header > div {
  min-width: 0;
}

.preset-adapter-review-header h3,
.preset-adapter-review-section h4 {
  margin: 0;
  line-height: 1.25;
}

.preset-adapter-review-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  gap: 0.75rem;
  overflow: auto;
  padding: 0.75rem;
}

.preset-adapter-review-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preset-adapter-review-item {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 0.65rem;
  background-color: var(--black30a);
}

.preset-adapter-review-item-failed {
  border-color: var(--SmartThemeQuoteColor);
}

.preset-adapter-review-item-main {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 0.45rem;
}

.preset-adapter-review-item-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-review-item p {
  margin: 0;
  color: var(--SmartThemeEmColor);
  font-size: 0.86rem;
  line-height: 1.35;
  word-break: break-word;
}

.preset-adapter-review-badge {
  flex: 0 0 auto;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 999px;
  padding: 0.08rem 0.45rem;
  background-color: var(--black30a);
  color: var(--SmartThemeBodyColor);
  font-size: 0.78rem;
  line-height: 1.35;
}

.preset-adapter-review-badge-create,
.preset-adapter-review-badge-export {
  border-color: var(--SmartThemeUnderlineColor);
}

.preset-adapter-review-badge-overwrite,
.preset-adapter-review-badge-failed,
.preset-adapter-review-badge-append {
  border-color: var(--SmartThemeQuoteColor);
}

.preset-adapter-review-item details {
  border-top: 1px solid var(--SmartThemeBorderColor);
  padding-top: 0.35rem;
}

.preset-adapter-review-item summary {
  color: var(--SmartThemeEmColor);
  cursor: pointer;
  font-size: 0.86rem;
}

.preset-adapter-review-item pre {
  max-height: 14rem;
  overflow: auto;
  margin: 0.45rem 0 0;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 6px;
  padding: 0.55rem;
  background-color: var(--black50a);
  color: var(--SmartThemeBodyColor);
  font: inherit;
  font-size: 0.82rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.preset-adapter-review-footer {
  align-items: center;
  justify-content: center;
  border-top: 1px solid var(--SmartThemeBorderColor);
  background-color: var(--black30a);
}

.preset-adapter-review-footer .menu_button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 5rem;
  min-height: 2rem;
  padding-inline: 0.75rem;
  white-space: nowrap;
}

.preset-adapter-debug {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.preset-adapter-debug-layout {
  display: grid;
  grid-template-columns: minmax(13rem, 0.85fr) minmax(0, 1.65fr);
  gap: 0.75rem;
  align-items: stretch;
  height: 100%;
  min-height: 0;
}

.preset-adapter-debug-records,
.preset-adapter-debug-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  gap: 0.55rem;
}

.preset-adapter-debug-section {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-width: 0;
  gap: 0.55rem;
}

.preset-adapter-debug-section > h4,
.preset-adapter-debug-row {
  flex: 0 0 auto;
}

.preset-adapter-debug-records {
  overflow: hidden;
}

.preset-adapter-debug-detail {
  overflow: auto;
  padding-right: 0.1rem;
  scrollbar-gutter: stable;
}

.preset-adapter-debug-pane-header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  min-width: 0;
  gap: 0.55rem;
}

.preset-adapter-debug-pane-header > div {
  min-width: 0;
}

.preset-adapter-debug-pane-header h4,
.preset-adapter-debug-section h4 {
  margin: 0;
  line-height: 1.25;
}

.preset-adapter-debug-pane-header .menu_button,
.preset-adapter-debug-row .menu_button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-height: 1.85rem;
  padding-inline: 0.65rem;
  white-space: nowrap;
}

.preset-adapter-debug-record-list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.45rem;
  min-height: 0;
  overflow: auto;
  padding-right: 0.1rem;
  scrollbar-gutter: stable;
}

.preset-adapter-debug-record {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.25rem;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 0.55rem;
  background-color: var(--black30a);
  color: var(--SmartThemeBodyColor);
  text-align: left;
  cursor: pointer;
}

.preset-adapter-debug-record:hover,
.preset-adapter-debug-record-active {
  border-color: var(--SmartThemeUnderlineColor);
  background-color: var(--black50a);
}

.preset-adapter-debug-record strong,
.preset-adapter-debug-record-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-debug-record small,
.preset-adapter-debug-record-summary {
  color: var(--SmartThemeEmColor);
  font-size: 0.8rem;
}

.preset-adapter-debug-metrics {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.preset-adapter-debug-metrics span {
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  background-color: var(--black30a);
  color: var(--SmartThemeEmColor);
  font-size: 0.8rem;
}

.preset-adapter-debug-row {
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 0.55rem;
  background-color: var(--black30a);
}

.preset-adapter-debug-row summary {
  overflow: hidden;
  color: var(--SmartThemeBodyColor);
  cursor: pointer;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-debug-row dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.35rem 0.55rem;
  margin: 0.55rem 0 0;
  border-top: 1px solid var(--SmartThemeBorderColor);
  padding-top: 0.5rem;
}

.preset-adapter-debug-row dt {
  color: var(--SmartThemeEmColor);
  font-size: 0.84rem;
}

.preset-adapter-debug-row dd {
  min-width: 0;
  margin: 0;
  color: var(--SmartThemeBodyColor);
  font-size: 0.84rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.preset-adapter-debug-row dd:has(.menu_button) {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
}

.preset-adapter-debug-row dd span {
  min-width: 0;
  flex: 1 1 auto;
}

.preset-adapter-debug-error-text,
.preset-adapter-debug-large-text {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 0.65rem;
  background-color: var(--black50a);
  color: var(--SmartThemeBodyColor);
  font: inherit;
  line-height: 1.45;
  resize: vertical;
}

.preset-adapter-debug-error-text {
  min-height: 8rem;
}

.preset-adapter-debug-text-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(58rem, calc(100vw - 2rem));
  height: min(42rem, calc(100dvh - 2rem));
  overflow: hidden;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  box-shadow: 0 12px 36px var(--black70a);
  background-color: color-mix(in srgb, var(--SmartThemeBlurTintColor) 94%, var(--black100) 6%);
  color: var(--SmartThemeBodyColor);
}

.preset-adapter-debug-text-panel .preset-adapter-review-header {
  align-items: center;
}

.preset-adapter-debug-large-text {
  flex: 1 1 auto;
  min-height: 0;
  border-width: 0;
  border-radius: 0;
  resize: none;
}

@container (max-width: 720px) {
  .preset-adapter-debug {
    flex: 0 0 auto;
    overflow: visible;
  }

  .preset-adapter-debug-layout {
    grid-template-columns: 1fr;
    align-items: start;
    height: auto;
  }

  .preset-adapter-debug-records {
    height: min(16rem, 42vh);
    min-height: 12rem;
  }

  .preset-adapter-debug-detail {
    overflow: visible;
    padding-right: 0;
  }

  .preset-adapter-debug-row dl {
    grid-template-columns: 1fr;
  }

  .preset-adapter-debug-row dd:has(.menu_button) {
    flex-direction: column;
  }
}

@media (max-width: 720px) {
  .preset-adapter-header {
    gap: 0.6rem;
  }

  .preset-adapter-options-grid {
    grid-template-columns: 1fr;
  }

  .preset-adapter-option {
    min-height: 3.4rem;
  }

  .preset-adapter-review-backdrop {
    align-items: stretch;
    padding: 0.6rem;
  }

  .preset-adapter-review-panel {
    width: 100%;
    max-height: calc(100dvh - 1.2rem);
  }

  .preset-adapter-review-header,
  .preset-adapter-review-body,
  .preset-adapter-review-footer {
    padding: 0.6rem;
  }

  .preset-adapter-review-footer .menu_button {
    flex: 0 1 auto;
  }

  .preset-adapter-debug-layout {
    grid-template-columns: 1fr;
    align-items: start;
    height: auto;
  }

  .preset-adapter-debug {
    flex: 0 0 auto;
    overflow: visible;
  }

  .preset-adapter-debug-records {
    height: min(16rem, 42vh);
    min-height: 12rem;
  }

  .preset-adapter-debug-detail {
    overflow: visible;
    padding-right: 0;
  }

  .preset-adapter-debug-record-list {
    max-height: none;
  }

  .preset-adapter-debug-row dl {
    grid-template-columns: 1fr;
  }

  .preset-adapter-debug-row dd:has(.menu_button) {
    flex-direction: column;
  }

  .preset-adapter-debug-text-panel {
    width: 100%;
    height: calc(100dvh - 1.2rem);
  }
}
</style>
