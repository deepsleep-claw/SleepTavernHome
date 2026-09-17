<template>
  <section class="pa-debug-panel" :class="'pa-debug-mobile-' + mobile_view" aria-label="Debug 诊断">
    <aside class="pa-debug-records">
      <header class="pa-debug-pane-heading">
        <div>
          <h4>请求记录</h4>
          <small>{{ records.length }} / 50 条</small>
        </div>
        <button type="button" :disabled="loading || !records.length" @click="confirm_clear = true">清空</button>
      </header>
      <div class="pa-debug-selection">
        <small>{{
          compare_ids.length ? '已选 ' + compare_ids.length + ' / 2 条对比' : '点记录右侧“对比”选择两条'
        }}</small>
        <button v-if="compare_ids.length" type="button" @click="compare_ids = []">取消对比</button>
      </div>
      <p v-if="loading" class="pa-debug-empty">正在载入记录…</p>
      <p v-else-if="!records.length" class="pa-debug-empty">暂无请求记录</p>
      <div v-else class="pa-debug-record-list">
        <article
          v-for="record in records"
          :key="record.id"
          class="pa-debug-record"
          :class="{ 'pa-debug-selected': record.id === selected?.id }"
        >
          <button
            type="button"
            class="pa-debug-record-open"
            :aria-pressed="record.id === selected?.id"
            @click="select(record.id)"
          >
            <time>{{ shortTime(record.created_at) }}</time>
            <strong>{{ record.generation?.character_name || '提示词记录' }}</strong>
            <span class="pa-debug-record-preview">{{ recordPreview(record) }}</span>
            <span class="pa-debug-record-bottom"
              ><span>{{ kindLabel(record) }} · {{ record.summary.total_rows }} 项</span
              ><span :class="{ 'pa-debug-danger': issues(record) > 0 }">{{
                issues(record) ? issues(record) + ' 异常' : record.summary.triggered_rows + ' 触发'
              }}</span></span
            >
          </button>
          <button
            type="button"
            class="pa-debug-record-compare"
            :class="{ 'pa-debug-chosen': compare_ids.includes(record.id) }"
            :aria-label="(compare_ids.includes(record.id) ? '取消对比 ' : '加入对比 ') + shortTime(record.created_at)"
            :aria-pressed="compare_ids.includes(record.id)"
            @click="toggleRecordComparison(record.id)"
          >
            {{ compare_ids.includes(record.id) ? (compare_ids.indexOf(record.id) === 0 ? '①' : '②') : '对比' }}
          </button>
        </article>
      </div>
    </aside>

    <section ref="detail_pane" class="pa-debug-detail">
      <template v-if="selected">
        <header class="pa-debug-pane-heading pa-debug-detail-heading">
          <div>
            <button type="button" class="pa-debug-back" @click="mobile_view = 'records'">‹ 记录列表</button>
            <h4>{{ selected.generation?.character_name || '提示词诊断' }}</h4>
            <small>{{ kindLabel(selected) }} · {{ fullTime(selected.created_at) }}</small>
          </div>
        </header>
        <div class="pa-debug-metrics">
          <div>
            <small>文本字数</small
            ><strong
              >{{ displayed_chars === null ? '—' : number(displayed_chars)
              }}<em v-if="displayed_chars !== null"> 字</em></strong
            >
          </div>
          <div>
            <small>触发条目</small><strong>{{ selected.summary.triggered_rows }}</strong>
          </div>
          <div :class="{ 'pa-debug-danger': issues(selected) > 0 }">
            <small>异常</small><strong>{{ issues(selected) }}</strong>
          </div>
        </div>
        <DebugTokenUsage :usage="selected.token_usage" />
        <p v-if="compare_ids.length === 1" class="pa-debug-note">再选一条记录，打开任意一条即可查看对比。</p>
        <section
          v-if="selected_in_pair && compare_ids.length === 2"
          class="pa-debug-comparison"
          aria-label="字数前缀对比"
        >
          <p v-if="comparing" class="pa-debug-note" role="status">正在读取正文并比较前缀…</p>
          <p v-if="comparison_error" class="pa-debug-danger" role="alert">{{ comparison_error }}</p>
          <template v-if="current_comparison">
            <div class="pa-debug-compare-heading">
              <span>当前 {{ number(current_comparison.current.chars) }} 字</span
              ><small
                >对照 {{ other_record ? shortTime(other_record.created_at) : '' }} ·
                {{ number(current_comparison.other.chars) }} 字</small
              >
            </div>
            <div
              class="pa-debug-progress"
              role="progressbar"
              aria-label="连续前缀字数命中"
              :aria-valuemin="0"
              :aria-valuemax="current_comparison.current.chars"
              :aria-valuenow="current_comparison.prefix_chars"
              :aria-valuetext="
                '命中 ' +
                number(current_comparison.prefix_chars) +
                ' 字，未命中 ' +
                number(current_comparison.missed_chars) +
                ' 字'
              "
            >
              <span class="pa-debug-progress-hit" :style="{ width: hit_percent + '%' }"></span
              ><span class="pa-debug-progress-miss" :style="{ width: miss_percent + '%' }"></span>
            </div>
            <div class="pa-debug-progress-labels">
              <span class="pa-debug-success"
                >命中 {{ number(current_comparison.prefix_chars) }} 字 · {{ percent(current_comparison.ratio) }}</span
              ><span class="pa-debug-danger"
                >未命中 {{ number(current_comparison.missed_chars) }} 字 ·
                {{ percent(current_comparison.ratio === null ? null : 1 - current_comparison.ratio) }}</span
              >
            </div>
            <div class="pa-debug-compare-footer">
              <small>按排序正文的连续相同前缀计算</small
              ><button
                v-if="current_comparison.first_difference_message !== null"
                type="button"
                @click="jumpToDifference"
              >
                首差 · 第 {{ current_comparison.first_difference_message }} 项 ↓</button
              ><span v-else class="pa-debug-success">当前文本全部匹配</span>
            </div>
            <p v-if="current_comparison.different_chat" class="pa-debug-warning">两条记录来自不同聊天。</p>
            <div v-if="other_record?.token_usage" class="pa-debug-other-usage">
              <small>对照记录</small><DebugTokenUsage :usage="other_record.token_usage" />
            </div>
          </template>
        </section>

        <nav class="pa-debug-tabs" aria-label="诊断内容">
          <button type="button" :aria-pressed="view === 'total'" @click="view = 'total'">
            总排序 {{ total_rows.length }}
          </button>
          <button type="button" :aria-pressed="view === 'triggered'" @click="view = 'triggered'">
            触发条目 {{ triggered_rows.length }}
          </button>
          <button
            type="button"
            :aria-pressed="view === 'errors'"
            :class="{ 'pa-debug-danger': issues(selected) > 0 }"
            @click="view = 'errors'"
          >
            异常 {{ issues(selected) }}
          </button>
        </nav>
        <div v-if="view !== 'errors'" class="pa-debug-rows">
          <p v-if="!visible_rows.length" class="pa-debug-empty">
            {{ view === 'total' ? '无排序信息' : '本次没有世界书触发记录' }}
          </p>
          <details
            v-for="(entry, index) in visible_rows"
            :key="selected.id + ':' + view + ':' + entry.key + ':' + comparison_key"
            class="pa-debug-row"
            :class="{ 'pa-debug-row-hit': rowState(index) === 'hit', 'pa-debug-row-miss': rowState(index) === 'miss' }"
            :data-prefix-state="rowState(index)"
            :open="rowState(index) === 'miss'"
          >
            <summary>
              <span class="pa-debug-index">{{ index + 1 }}</span>
              <span class="pa-debug-row-name"
                ><span class="pa-debug-row-title"
                  ><strong :title="rowName(entry.row, index)">{{ rowName(entry.row, index) }}</strong
                  ><small>{{ compactMeta(entry.row) }}</small></span
                ><span class="pa-debug-row-preview">{{ preview(entry.row, 100) }}</span></span
              >
              <span class="pa-debug-row-end"
                ><span v-if="rowState(index)">{{ rowState(index) === 'hit' ? '命中' : '首差' }}</span
                ><span v-else-if="entry.row.提取状态">{{ rowStatus(entry.row) }}</span
                ><small
                  >{{
                    number(
                      current_comparison && view === 'total'
                        ? current_comparison.current.entries[index].end -
                            current_comparison.current.entries[index].start
                        : rowLength(entry.row),
                    )
                  }}
                  字</small
                ></span
              >
            </summary>
            <div class="pa-debug-row-body">
              <DebugPrefixDiff
                v-if="rowState(index) === 'miss' && current_comparison?.difference"
                :current-text="current_comparison.difference.current_text"
                :other-text="current_comparison.difference.other_text"
                :prefix-units="current_comparison.difference.prefix_units"
                :current-label="'当前 · ' + shortTime(selected.created_at)"
                :other-label="'对照 · ' + (other_record ? shortTime(other_record.created_at) : '')"
              />
              <dl>
                <template v-for="field in rowFields(entry.row)" :key="field.key"
                  ><dt>{{ field.key }}</dt>
                  <dd>{{ field.value }}</dd></template
                >
              </dl>
              <p v-if="rowState(index) !== 'miss'" class="pa-debug-preview">
                {{ excerpt(debugValue(entry.row.详细内容摘要 ?? entry.row.详细内容), 240) }}
              </p>
              <button type="button" @click="openContent(entry.row)">查看完整正文</button>
              <details class="pa-debug-metadata">
                <summary>元数据</summary>
                <pre>{{ JSON.stringify(metadata(entry.row), null, 2) }}</pre>
              </details>
            </div>
          </details>
        </div>
        <div v-else class="pa-debug-errors">
          <p v-if="!error_logs.length && !failed_rows.length" class="pa-debug-empty">没有异常记录</p>
          <details v-for="(message, index) in error_logs" :key="index">
            <summary>错误 {{ index + 1 }} · {{ excerpt(message.split('\n')[0], 80) }}</summary>
            <pre>{{ message }}</pre>
          </details>
          <p v-for="entry in failed_rows" :key="entry.key" class="pa-debug-danger">
            {{ rowName(entry.row, 0) }} · {{ debugValue(entry.row.失败原因) }}
          </p>
        </div>
        <details class="pa-debug-technical">
          <summary>诊断详情</summary>
          <dl>
            <template v-for="field in technicalFields(selected)" :key="field.key"
              ><dt>{{ field.key }}</dt>
              <dd>{{ field.value }}</dd></template
            >
          </dl>
          <button type="button" @click="showText('原始 Debug 数据', JSON.stringify(selected, null, 2))">
            查看原始数据
          </button>
        </details>
      </template>
      <p v-else class="pa-debug-empty">请选择一条记录</p>
    </section>

    <AdapterModal v-if="text_modal" :title="text_modal.title" wide @close="closeText">
      <textarea
        class="pa-debug-full-text"
        readonly
        :aria-label="text_modal.title"
        :value="text_modal.content"
      ></textarea>
    </AdapterModal>
    <AdapterModal v-if="confirm_clear" title="清空 Debug 记录" @close="confirm_clear = false"
      ><p>清空保存的请求记录与完整正文？</p>
      <template #footer
        ><button
          type="button"
          @click="
            confirm_clear = false;
            $emit('clear');
          "
        >
          清空记录</button
        ><button type="button" @click="confirm_clear = false">取消</button></template
      ></AdapterModal
    >
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { SquashDebugRecord } from '../压缩相邻消息/debug_types';
import AdapterModal from './AdapterModal.vue';
import DebugPrefixDiff from './DebugPrefixDiff.vue';
import DebugTokenUsage from './DebugTokenUsage.vue';
import {
  compareDebugRecords,
  comparisonForRecord,
  comparisonRowState,
  debugRows,
  debugValue,
  loadDebugText,
  textCharacters,
  type DebugComparison,
  type DebugRow,
  type ReadDebugContent,
} from './debug_compare';

const props = defineProps<{
  records: SquashDebugRecord[];
  selectedId: string;
  loading: boolean;
  readContent: ReadDebugContent;
}>();
const emit = defineEmits<{ select: [id: string]; clear: [] }>();
const selected = computed(() => props.records.find(record => record.id === props.selectedId) ?? props.records[0]);
const total_rows = computed(() => debugRows(selected.value?.state.total_rows));
const triggered_rows = computed(() => debugRows(selected.value?.state.triggered_rows));
const failed_rows = computed(() =>
  triggered_rows.value.filter(entry => debugValue(entry.row.提取状态).includes('失败')),
);
const view = ref<'total' | 'triggered' | 'errors'>('total');
const visible_rows = computed(() => (view.value === 'triggered' ? triggered_rows.value : total_rows.value));
const error_logs = computed(
  () =>
    (Array.isArray(selected.value?.state.error_logs) ? selected.value.state.error_logs : []).map(
      debugValue,
    ) as string[],
);
const mobile_view = ref<'records' | 'detail'>('records');
const compare_ids = ref<string[]>([]);
const comparison_key = computed(() => compare_ids.value.join(':'));
const comparison = ref<DebugComparison>();
const current_comparison = computed(() =>
  comparison.value && selected.value ? comparisonForRecord(comparison.value, selected.value.id) : undefined,
);
const other_record = computed(() => props.records.find(record => record.id === current_comparison.value?.other.id));
const selected_in_pair = computed(() => !!selected.value && compare_ids.value.includes(selected.value.id));
const displayed_chars = computed(
  () =>
    current_comparison.value?.current.chars ??
    (total_rows.value.length
      ? total_rows.value.reduce((sum, entry) => sum + rowLength(entry.row), 0)
      : (selected.value?.summary.prompt_chars ?? null)),
);
const hit_percent = computed(() => (current_comparison.value?.ratio ?? 0) * 100);
const miss_percent = computed(() =>
  current_comparison.value?.ratio === null || !current_comparison.value ? 0 : 100 - hit_percent.value,
);
const comparing = ref(false);
const comparison_error = ref('');
const detail_pane = ref<HTMLElement>();
const confirm_clear = ref(false);
const text_modal = ref<{ title: string; content: string }>();
let comparison_serial = 0;
let content_serial = 0;
const number = (value: number) => value.toLocaleString('zh-CN');
const percent = (value: number | null) => (value === null ? '—' : (value * 100).toFixed(1) + '%');
const issues = (record: SquashDebugRecord) => Math.max(record.summary.error_count, record.summary.failed);

function kindLabel(record: SquashDebugRecord): string {
  if (!record.generation) return '历史';
  if (record.generation.dry_run) return '预演';
  return (
    (
      {
        normal: '正式生成',
        quiet: '后台生成',
        regenerate: '重新生成',
        swipe: '切换回复',
        continue: '继续生成',
      } as Record<string, string>
    )[record.generation.type] ?? '正式请求'
  );
}
function fullTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}
function shortTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) +
        '.' +
        String(date.getMilliseconds()).padStart(3, '0');
}
function select(id: string) {
  emit('select', id);
  mobile_view.value = 'detail';
}
function rowName(row: DebugRow, index: number): string {
  return debugValue(row.名称) || '条目 ' + (index + 1);
}
function rowStatus(row: DebugRow): string {
  return debugValue(row.提取状态).replace(/^等待处理$/, '未提取');
}
function rowLength(row: DebugRow): number {
  return typeof row.详细内容字数 === 'number'
    ? row.详细内容字数
    : typeof row.详细内容长度 === 'number'
      ? row.详细内容长度
      : textCharacters(debugValue(row.详细内容));
}
function excerpt(value: string, size: number): string {
  return value.length > size ? value.slice(0, size) + '…' : value;
}
function preview(row: DebugRow, size: number): string {
  return excerpt(
    debugValue(row.详细内容摘要 ?? row.详细内容)
      .replace(/\s+/g, ' ')
      .trim(),
    size,
  );
}
function compactMeta(row: DebugRow): string {
  return excerpt([row.来源, row.类型 || row.触发类型].filter(Boolean).map(debugValue).join(' · '), 40);
}
function recordPreview(record: SquashDebugRecord): string {
  const rows = debugRows(record.state.total_rows);
  const entry =
    rows.find(item => debugValue(item.row.类型).startsWith('历史信息')) ??
    rows.find(item => debugValue(item.row.类型).startsWith('世界书')) ??
    rows[0];
  return entry ? preview(entry.row, 70) : '';
}
function rowFields(row: DebugRow) {
  return ['来源', '触发原因', '触发类型', '固定位置', '提取状态', '失败原因'].flatMap(key =>
    row[key] ? [{ key, value: debugValue(row[key]) }] : [],
  );
}
function metadata(row: DebugRow) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== '详细内容' && key !== '详细内容摘要'));
}
function technicalFields(record: SquashDebugRecord) {
  const fields: { key: string; value: string | number }[] = [
    { key: '已载入条目', value: record.summary.loaded_total },
    { key: '绿灯缓存插入', value: record.summary.green_cache_insertions },
    { key: '清理前配对标记', value: record.summary.wrapper_paired },
    { key: '清理前孤立标记', value: record.summary.wrapper_orphan },
    { key: '记录 ID', value: record.id },
  ];
  if (record.generation)
    fields.push(
      { key: '请求 ID', value: record.generation.id },
      { key: '事件', value: record.generation.event },
      { key: '聊天', value: record.generation.chat_id },
      { key: '脚本 ID', value: record.generation.script_id },
      { key: '请求内回调序号', value: record.generation.pass },
      { key: '此前跳过的预演', value: record.generation.skipped_previews },
    );
  if (record.token_usage?.response_id) fields.push({ key: '响应 ID', value: record.token_usage.response_id });
  return fields;
}
function toggleRecordComparison(id: string) {
  compare_ids.value = compare_ids.value.includes(id)
    ? compare_ids.value.filter(value => value !== id)
    : [...compare_ids.value.slice(-1), id];
}
function rowState(index: number) {
  return view.value === 'total' ? comparisonRowState(current_comparison.value, index) : undefined;
}
async function jumpToDifference() {
  view.value = 'total';
  await nextTick();
  const entry = detail_pane.value?.querySelector<HTMLElement>('.pa-debug-row-miss');
  if (entry && detail_pane.value)
    detail_pane.value.scrollTop +=
      entry.getBoundingClientRect().top - detail_pane.value.getBoundingClientRect().top - 12;
}
async function runComparison() {
  const serial = ++comparison_serial;
  comparison.value = undefined;
  comparison_error.value = '';
  comparing.value = false;
  if (compare_ids.value.length !== 2) return;
  const left = props.records.find(record => record.id === compare_ids.value[0]);
  const right = props.records.find(record => record.id === compare_ids.value[1]);
  if (!left || !right) return;
  comparing.value = true;
  view.value = 'total';
  try {
    const result = await compareDebugRecords(left, right, props.readContent);
    if (serial === comparison_serial) comparison.value = result;
  } catch (error) {
    if (serial === comparison_serial) comparison_error.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (serial === comparison_serial) comparing.value = false;
  }
}
function showText(title: string, content: string) {
  content_serial++;
  text_modal.value = { title, content };
}
function closeText() {
  content_serial++;
  text_modal.value = undefined;
}
async function openContent(row: DebugRow) {
  if (!selected.value) return;
  const serial = ++content_serial;
  const title = rowName(row, 0);
  text_modal.value = { title, content: '正在读取完整正文…' };
  try {
    const content = await loadDebugText(selected.value.id, row, props.readContent);
    if (serial === content_serial) text_modal.value = { title, content };
  } catch (error) {
    if (serial === content_serial)
      text_modal.value = {
        title,
        content: String(error instanceof Error ? error.message : error) + '\n\n现有预览：\n' + debugValue(row.详细内容),
      };
  }
}
watch(comparison_key, () => {
  void runComparison();
});
watch(
  () => props.records,
  () => {
    const ids = compare_ids.value.filter(id => props.records.some(record => record.id === id));
    if (ids.length !== compare_ids.value.length) compare_ids.value = ids;
  },
);
watch(
  () => selected.value?.id,
  async () => {
    await nextTick();
    if (detail_pane.value) detail_pane.value.scrollTop = 0;
  },
);
onBeforeUnmount(() => {
  comparison_serial++;
  content_serial++;
});
</script>

<style scoped>
.pa-debug-panel {
  display: grid;
  grid-template-columns: minmax(12rem, 15rem) minmax(0, 1fr);
  flex: 1 1 0;
  gap: 0.85rem;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--pa-text);
}
.pa-debug-records,
.pa-debug-detail {
  min-width: 0;
  min-height: 0;
}
.pa-debug-records {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--pa-border);
  padding-right: 0.65rem;
}
.pa-debug-pane-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-bottom: 0.7rem;
}
.pa-debug-pane-heading > div {
  min-width: 0;
}
.pa-debug-pane-heading h4 {
  margin: 0 0 0.2rem;
  font-size: 1rem;
  overflow-wrap: anywhere;
}
.pa-debug-panel small,
.pa-debug-note {
  color: var(--pa-muted);
}
.pa-debug-panel button {
  min-width: 0;
  border: 1px solid var(--pa-border);
  border-radius: 7px;
  padding: 0.35rem 0.55rem;
  background: var(--pa-surface-soft);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.pa-debug-panel button:disabled {
  opacity: 0.45;
  cursor: default;
}
.pa-debug-panel button:focus-visible,
.pa-debug-panel summary:focus-visible {
  outline: 2px solid var(--pa-coral);
  outline-offset: 2px;
}
.pa-debug-selection {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  min-height: 2rem;
  margin-bottom: 0.4rem;
  font-size: 0.75rem;
}
.pa-debug-selection button {
  padding: 0.2rem 0.3rem;
  white-space: nowrap;
}
.pa-debug-record-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow: auto;
  min-height: 0;
  padding-right: 0.25rem;
}
.pa-debug-record {
  position: relative;
  flex: 0 0 auto;
  border: 1px solid var(--pa-border);
  border-radius: 8px;
  background: var(--pa-surface-soft);
  min-width: 0;
}
.pa-debug-panel .pa-debug-record-open {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border: 0;
  background: none;
  padding: 0.5rem;
  width: 100%;
  text-align: left;
}
.pa-debug-record-open time {
  padding-right: 2rem;
  font-size: 0.72rem;
  color: var(--pa-muted);
}
.pa-debug-record strong {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.9rem;
  max-width: 100%;
}
.pa-debug-record-preview {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  color: var(--pa-muted);
  font-size: 0.75rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.pa-debug-record-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 0.3rem;
  font-size: 0.72rem;
  color: var(--pa-muted);
}
.pa-debug-panel .pa-debug-record-compare {
  position: absolute;
  top: 0.3rem;
  right: 0.3rem;
  font-size: 0.7rem;
  padding: 0.2rem 0.3rem;
}
.pa-debug-panel .pa-debug-chosen {
  border-color: #66b990;
  color: #85d8ac;
  background: rgb(70 162 116 / 17%);
}
.pa-debug-selected {
  border-color: var(--pa-coral);
  background: var(--pa-coral-soft);
  box-shadow: inset 3px 0 0 var(--pa-coral);
}
.pa-debug-detail {
  overflow: auto;
  padding-right: 0.3rem;
  scrollbar-gutter: stable;
}
.pa-debug-detail-heading {
  flex-wrap: wrap;
}
.pa-debug-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}
.pa-debug-metrics > div {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  border: 1px solid var(--pa-border);
  border-radius: 9px;
  padding: 0.6rem;
  background: var(--pa-surface-soft);
}
.pa-debug-metrics strong {
  font-size: 1.3rem;
}
.pa-debug-metrics em {
  font-style: normal;
  font-size: 0.75rem;
  color: var(--pa-muted);
}
.pa-debug-panel .pa-debug-danger {
  color: #e9929a;
}
.pa-debug-success {
  color: #85d8ac;
}
.pa-debug-warning {
  color: var(--pa-gold, #dabd7f);
  font-size: 0.8rem;
}
.pa-debug-tabs {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin: 0.6rem 0;
  border-bottom: 1px solid var(--pa-border);
  padding-bottom: 0.5rem;
}
.pa-debug-tabs [aria-pressed='true'] {
  color: var(--pa-coral);
  border-color: var(--pa-coral);
}
.pa-debug-rows {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.pa-debug-row {
  border: 1px solid var(--pa-border);
  border-radius: 8px;
  background: var(--pa-surface-soft);
}
.pa-debug-row-hit {
  border-color: #548d70;
  background: rgb(57 137 95 / 12%);
  box-shadow: inset 3px 0 0 #68b58a;
}
.pa-debug-row-miss {
  border-color: #bb6d79;
  background: rgb(173 65 82 / 10%);
  box-shadow: inset 3px 0 0 #d9818d;
}
.pa-debug-row > summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.55rem;
  list-style: none;
}
.pa-debug-row > summary::before {
  content: '›';
  color: var(--pa-muted);
}
.pa-debug-row[open] > summary::before {
  transform: rotate(90deg);
}
.pa-debug-index {
  flex: 0 0 1.3rem;
  font-variant-numeric: tabular-nums;
  color: var(--pa-muted);
  font-size: 0.8rem;
}
.pa-debug-row-name {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 0.3rem;
}
.pa-debug-row-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.6rem;
  min-width: 0;
}
.pa-debug-row-title strong {
  overflow-wrap: anywhere;
  font-size: 0.9rem;
}
.pa-debug-row-title small {
  font-size: 0.7rem;
  overflow-wrap: anywhere;
}
.pa-debug-row-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  color: var(--pa-muted);
}
.pa-debug-row-end {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  text-align: right;
  font-size: 0.75rem;
}
.pa-debug-row-hit .pa-debug-row-end > span {
  color: #85d8ac;
}
.pa-debug-row-miss .pa-debug-row-end > span {
  color: #e9929a;
}
.pa-debug-row-body {
  border-top: 1px solid var(--pa-border);
  padding: 0.65rem;
  min-width: 0;
}
.pa-debug-panel dl {
  display: grid;
  grid-template-columns: minmax(5rem, auto) minmax(0, 1fr);
  gap: 0.3rem 0.8rem;
  font-size: 0.8rem;
}
.pa-debug-panel dt {
  color: var(--pa-muted);
}
.pa-debug-panel dd {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.pa-debug-preview {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.85rem;
  color: var(--pa-muted);
}
.pa-debug-technical,
.pa-debug-metadata {
  margin-top: 0.7rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--pa-border);
}
.pa-debug-panel summary {
  cursor: pointer;
}
.pa-debug-technical > summary,
.pa-debug-metadata > summary {
  color: var(--pa-muted);
  font-size: 0.8rem;
}
.pa-debug-metadata pre,
.pa-debug-errors pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 0.8rem;
  max-height: 24rem;
  overflow: auto;
}
.pa-debug-empty {
  padding: 1.2rem 0.6rem;
  color: var(--pa-muted);
  text-align: center;
}
.pa-debug-comparison {
  padding: 0.7rem;
  border: 1px solid var(--pa-border);
  border-radius: 10px;
  background: var(--pa-surface-soft);
}
.pa-debug-compare-heading,
.pa-debug-progress-labels,
.pa-debug-compare-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.3rem 0.6rem;
  font-size: 0.8rem;
}
.pa-debug-progress {
  display: flex;
  width: 100%;
  height: 0.85rem;
  margin: 0.7rem 0 0.5rem;
  overflow: hidden;
  border-radius: 6px;
  background: var(--pa-border);
}
.pa-debug-progress span {
  display: block;
  height: 100%;
}
.pa-debug-progress-hit {
  background: #58af7d;
}
.pa-debug-progress-miss {
  background: #d77481;
}
.pa-debug-compare-footer {
  margin-top: 0.55rem;
  font-size: 0.75rem;
}
.pa-debug-compare-footer button {
  font-size: 0.75rem;
}
.pa-debug-note {
  font-size: 0.8rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.pa-debug-other-usage {
  margin-top: 0.4rem;
  border-top: 1px solid var(--pa-border);
  padding-top: 0.4rem;
  font-size: 0.75rem;
}
.pa-debug-other-usage > small {
  color: var(--pa-muted);
}
.pa-debug-errors details {
  margin-bottom: 0.6rem;
}
.pa-debug-full-text {
  box-sizing: border-box;
  width: 100%;
  min-height: 20rem;
  resize: vertical;
  border: 1px solid var(--pa-border);
  padding: 0.7rem;
  background: var(--pa-ink);
  color: var(--pa-text);
  font: inherit;
  font-size: 0.85rem;
}
.pa-debug-back {
  display: none;
}
@container (max-width: 760px) {
  .pa-debug-panel {
    grid-template-columns: minmax(0, 1fr);
  }
  .pa-debug-mobile-records .pa-debug-detail,
  .pa-debug-mobile-detail .pa-debug-records {
    display: none;
  }
  .pa-debug-records {
    border: 0;
    padding-right: 0;
  }
  .pa-debug-back {
    display: inline-block;
    margin-bottom: 0.5rem;
  }
  .pa-debug-metrics strong {
    font-size: 1.05rem;
  }
}
</style>
