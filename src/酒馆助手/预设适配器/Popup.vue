<template>
  <div class="preset-adapter-root" :class="`preset-adapter-root-${store.active_tab}`">
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

    <nav class="preset-adapter-tabs" aria-label="梦鲸思客设置页签">
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
        :class="{ 'preset-adapter-tab-active': store.active_tab === 'summary' }"
        @click="store.setActiveTab('summary')"
      >
        总结
        <span v-if="store.summary_state.summary_count > 0">{{ store.summary_state.summary_count }}</span>
      </button>
      <button
        type="button"
        class="preset-adapter-tab"
        :class="{ 'preset-adapter-tab-active': store.active_tab === 'debug' }"
        :disabled="!store.debug_available"
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

    <section v-else-if="store.active_tab === 'summary'" class="preset-adapter-summary">
      <div v-if="!store.summary_state.has_chat" class="preset-adapter-empty">需要打开一个聊天后才能使用总结功能。</div>

      <template v-else>
        <div class="preset-adapter-stats">
          <span>已总结 {{ store.summary_state.summary_count }} 次</span>
          <span>发送楼层 {{ store.summary_state.unhidden_message_count }} / {{ store.summary_state.total_message_count }}</span>
        </div>

        <section class="preset-adapter-summary-section">
          <header class="preset-adapter-summary-inline-header">
            <h4>当前总结楼层</h4>
            <div class="preset-adapter-summary-inline-actions">
              <button type="button" class="menu_button" :disabled="store.is_applying" @click="addSummaryMessage()">添加</button>
              <button type="button" class="menu_button" :disabled="store.is_applying" @click="store.scanCurrentSummaryMessages()">
                扫描
              </button>
            </div>
          </header>
          <div v-if="store.summary_state.summary_messages.length === 0" class="preset-adapter-empty">暂无总结楼层</div>
          <table v-else class="preset-adapter-summary-table">
            <thead>
              <tr>
                <th>楼层</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="message in store.summary_state.summary_messages" :key="message.message_id">
                <td>第 {{ message.message_id }} 层</td>
                <td>{{ message.exists ? (message.is_hidden ? '隐藏' : '显示') : '失效' }}</td>
                <td>
                  <button
                    type="button"
                    class="menu_button"
                    :disabled="store.is_applying"
                    @click="store.deleteSummaryMessageId(message.message_id)"
                  >
                    删除标记
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <details class="preset-adapter-summary-section preset-adapter-summary-panel">
          <summary>当前总结内容</summary>
          <div v-if="store.summary_state.summary_messages.length === 0" class="preset-adapter-empty">暂无总结楼层</div>
          <div v-else class="preset-adapter-summary-message-list">
            <details
              v-for="message in store.summary_state.summary_messages"
              :key="message.message_id"
              class="preset-adapter-summary-message"
            >
              <summary>
                <span>第 {{ message.message_id }} 层总结</span>
                <small v-if="!message.exists">失效</small>
                <small v-else>{{ message.is_hidden ? '隐藏' : '显示' }}</small>
              </summary>
              <div v-if="!message.exists" class="preset-adapter-empty">该楼层已不存在。</div>
              <div v-else class="preset-adapter-summary-content">
                <div
                  v-for="(segment, segment_index) in message.content_segments"
                  :key="segment_index"
                  class="preset-adapter-summary-rendered"
                  v-html="renderSummarySegment(segment, message.message_id)"
                ></div>
              </div>
            </details>
          </div>
        </details>

        <details class="preset-adapter-summary-section preset-adapter-summary-panel">
          <summary>楼层信息摘要</summary>
          <div v-if="store.summary_state.floor_rows.length === 0" class="preset-adapter-empty">暂无楼层信息</div>
          <table v-else class="preset-adapter-summary-table">
            <thead>
              <tr>
                <th>楼层</th>
                <th>状态</th>
                <th>Token数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in store.summary_state.floor_rows" :key="row.key" :class="{ 'preset-adapter-summary-total-row': row.total }">
                <td>{{ row.range }}</td>
                <td>{{ row.status }}</td>
                <td>{{ row.token_count }}</td>
                <td>
                  <button
                    v-if="row.operation_label"
                    type="button"
                    class="menu_button"
                    :disabled="store.is_applying"
                    @click="store.setSummaryFloorRowHidden(row)"
                  >
                    {{ row.operation_label }}
                  </button>
                  <span v-else>-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </details>

        <details class="preset-adapter-summary-section preset-adapter-summary-panel preset-adapter-summary-settings">
          <summary>总结功能设置</summary>

          <div class="preset-adapter-summary-setting-block">
            <h4>总结使用设置</h4>
            <dl class="preset-adapter-summary-definition">
              <dt>设置组</dt>
              <dd>{{ store.summary_generation_status.group_label || '未配置' }}</dd>
              <dt>选项</dt>
              <dd>{{ store.summary_generation_status.option_label || '未配置' }}</dd>
              <dt>当前状态</dt>
              <dd>{{ store.summary_generation_status.status_label }}</dd>
              <dt>命中提示词</dt>
              <dd>{{ store.summary_generation_status.matched_summary || '无' }}</dd>
            </dl>
            <ul v-if="store.summary_generation_status.errors.length > 0" class="preset-adapter-summary-error-list">
              <li v-for="error in store.summary_generation_status.errors" :key="error">{{ error }}</li>
            </ul>
          </div>

          <div class="preset-adapter-summary-setting-grid">
            <label>
              <span>总结内容处理</span>
              <select :value="store.summary_settings.content_handling" @change="setSummaryContentHandling">
                <option value="direct">直接总结</option>
                <option value="worldbook">放置于世界书</option>
                <option value="first_message">放置于首层</option>
              </select>
            </label>
            <label>
              <span>总结结束后</span>
              <select :value="store.summary_settings.after_summary" @change="setSummaryAfterAction">
                <option value="none">无动作</option>
                <option value="hide_summary_message">隐藏总结楼层</option>
              </select>
            </label>
          </div>
          <p class="preset-adapter-description">若总结内容处理为放置于世界书或放置于首层，推荐开启隐藏总结楼层。</p>
        </details>

        <section class="preset-adapter-summary-section">
          <h4>隐藏楼层设置</h4>
          <div class="preset-adapter-summary-checkbox-grid">
            <label>
              <input
                type="checkbox"
                :checked="store.summary_settings.hide_rules.hide_first"
                @change="setSummaryHideRule('hide_first', $event)"
              />
              <span>隐藏首层</span>
            </label>
            <label>
              <input
                type="checkbox"
                :checked="store.summary_settings.hide_rules.hide_user"
                @change="setSummaryHideRule('hide_user', $event)"
              />
              <span>隐藏用户输入楼层</span>
            </label>
            <label>
              <input
                type="checkbox"
                :checked="store.summary_settings.hide_rules.hide_assistant_system"
                @change="setSummaryHideRule('hide_assistant_system', $event)"
              />
              <span>隐藏系统/助手楼层</span>
            </label>
            <label>
              <input
                type="checkbox"
                :checked="store.summary_settings.hide_rules.hide_summary"
                @change="setSummaryHideRule('hide_summary', $event)"
              />
              <span>隐藏总结楼层</span>
            </label>
            <label>
              <input
                type="checkbox"
                :checked="store.summary_settings.hide_rules.auto_hide_after_manual"
                @change="setSummaryHideRule('auto_hide_after_manual', $event)"
              />
              <span>手动总结后自动隐藏楼层</span>
            </label>
          </div>

          <div class="preset-adapter-actions">
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmApplySummaryHideOnly()">
              一键隐藏
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmSyncSummaryHideRules()">
              一键隐藏（取消隐藏非设置楼层）
            </button>
            <button type="button" class="menu_button" :disabled="store.is_applying" @click="confirmUnhideSummaryAll()">
              全部取消隐藏
            </button>
          </div>
        </section>

        <button
          type="button"
          class="menu_button preset-adapter-summary-start"
          :disabled="
            store.is_applying ||
            store.is_summary_running ||
            store.is_generation_in_progress ||
            !store.summary_generation_status.can_start
          "
          @click="confirmStartSummary()"
        >
          {{ store.is_generation_in_progress && !store.is_summary_running ? '生成中...' : store.is_summary_running ? '总结中...' : '开始总结' }}
        </button>
      </template>
    </section>

    <section v-else-if="store.active_tab === 'debug'" class="preset-adapter-debug">
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
import {
  type SummaryAfterAction,
  type SummaryContentHandling,
  type SummaryHideRules,
  usePresetAdapterStore,
} from './store';

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
  store.startSummaryWatch();
});

onBeforeUnmount(() => {
  store.stopDebugWatch();
  store.stopSummaryWatch();
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

function isConfirmed(result: unknown): boolean {
  return result === true || result === SillyTavern.POPUP_RESULT.AFFIRMATIVE;
}

async function confirmPopup(message: string): Promise<boolean> {
  return isConfirmed(await SillyTavern.callGenericPopup(message, SillyTavern.POPUP_TYPE.CONFIRM));
}

function getEventValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function getEventChecked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function setSummaryContentHandling(event: Event) {
  store.setSummaryContentHandling(getEventValue(event) as SummaryContentHandling);
}

function setSummaryAfterAction(event: Event) {
  store.setSummaryAfterAction(getEventValue(event) as SummaryAfterAction);
}

function setSummaryHideRule(rule: keyof SummaryHideRules, event: Event) {
  store.setSummaryHideRule(rule, getEventChecked(event));
}

function renderSummarySegment(segment: string, message_id: number): string {
  return SillyTavern.messageFormatting(segment, '', false, false, message_id);
}

async function addSummaryMessage() {
  const result = await SillyTavern.callGenericPopup('请输入要标记为总结层的楼层号。', SillyTavern.POPUP_TYPE.INPUT);
  if (result === undefined || result === false || result === SillyTavern.POPUP_RESULT.CANCELLED) {
    return;
  }

  const input = String(result).trim();
  if (!/^\d+$/.test(input)) {
    toastr.error('请输入有效的楼层号。');
    return;
  }

  const message_id = Number(input);
  store.addSummaryMessageIdFromInput(message_id);
}

async function confirmApplySummaryHideOnly() {
  if (await confirmPopup('确认按当前规则隐藏命中楼层？不会取消隐藏未命中的楼层。')) {
    await store.applySummaryHideOnly();
  }
}

async function confirmSyncSummaryHideRules() {
  if (await confirmPopup('确认按当前规则同步所有楼层隐藏状态？未命中的楼层会被取消隐藏。')) {
    await store.syncSummaryHideRules();
  }
}

async function confirmUnhideSummaryAll() {
  if (await confirmPopup('确认取消隐藏当前聊天的所有楼层？')) {
    await store.unhideSummaryAll();
  }
}

async function confirmStartSummary() {
  await store.startManualSummary();
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

const debug_content_metadata_keys = new Set(['详细内容摘要', '详细内容长度', '详细内容hash', '详细内容缓存键']);

function getDebugRowFields(row: DebugRow): { key: string; preview: string; text: string }[] {
  return Object.entries(row)
    .filter(([key]) => !debug_content_metadata_keys.has(key))
    .map(([key, value]) => ({
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

.preset-adapter-root-summary {
  flex: 0 0 auto;
  min-height: 100%;
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

.preset-adapter-tab:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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

.preset-adapter-summary {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  padding-bottom: 1.25rem;
}

.preset-adapter-summary-section {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  border-top: 1px solid var(--SmartThemeBorderColor);
  padding-top: 0.75rem;
}

.preset-adapter-summary-section > h4,
.preset-adapter-summary-setting-block h4,
.preset-adapter-summary-inline-header h4 {
  margin: 0;
  line-height: 1.25;
}

.preset-adapter-summary-message-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.preset-adapter-summary-message {
  margin-left: 0.75rem;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  background-color: var(--black30a);
}

.preset-adapter-summary-message summary {
  padding-left: 0.95rem;
}

.preset-adapter-summary-message summary,
.preset-adapter-summary-panel > summary {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.65rem;
  padding: 0.55rem 0.65rem;
  cursor: pointer;
  font-weight: 700;
  list-style: none;
}

.preset-adapter-summary-message summary::-webkit-details-marker,
.preset-adapter-summary-panel > summary::-webkit-details-marker {
  display: none;
}

.preset-adapter-summary-message summary::before,
.preset-adapter-summary-panel > summary::before {
  content: '';
  width: 0;
  height: 0;
  border-top: 0.32rem solid transparent;
  border-bottom: 0.32rem solid transparent;
  border-left: 0.42rem solid var(--SmartThemeEmColor);
  transition: transform 120ms ease;
}

.preset-adapter-summary-message[open] > summary::before,
.preset-adapter-summary-panel[open] > summary::before {
  transform: rotate(90deg);
}

.preset-adapter-summary-message small {
  margin-left: auto;
  color: var(--SmartThemeEmColor);
  font-weight: 400;
}

.preset-adapter-summary-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: min(28rem, 55vh);
  overflow: auto;
  border-top: 1px solid var(--SmartThemeBorderColor);
  padding: 0.65rem;
}

.preset-adapter-summary-rendered {
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.preset-adapter-summary-rendered table {
  width: 100%;
  border-collapse: collapse;
  margin-block: 0.75rem;
  border: 1px solid var(--SmartThemeBorderColor);
  font-size: 0.92em;
}

.preset-adapter-summary-rendered th,
.preset-adapter-summary-rendered td {
  border: 1px solid var(--SmartThemeBorderColor);
  padding: 0.42rem 0.55rem;
  text-align: left;
  vertical-align: top;
}

.preset-adapter-summary-rendered thead th {
  background-color: var(--black50a);
  color: var(--SmartThemeEmColor);
  font-weight: 700;
}

.preset-adapter-summary-rendered tbody tr:nth-child(odd) {
  background-color: var(--black30a);
}

.preset-adapter-summary-rendered tbody tr:nth-child(even) {
  background-color: color-mix(in srgb, var(--black30a) 45%, transparent);
}

.preset-adapter-summary-table {
  width: 100%;
  border-collapse: collapse;
  overflow: hidden;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  font-size: 0.9rem;
}

.preset-adapter-summary-table th,
.preset-adapter-summary-table td {
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  padding: 0.45rem 0.55rem;
  text-align: left;
  vertical-align: top;
}

.preset-adapter-summary-table th {
  background-color: var(--black30a);
  color: var(--SmartThemeEmColor);
  font-weight: 700;
}

.preset-adapter-summary-table tr:last-child td {
  border-bottom: 0;
}

.preset-adapter-summary-total-row td {
  background-color: var(--black50a);
  color: var(--SmartThemeEmColor);
  font-weight: 700;
}

.preset-adapter-summary-table .menu_button {
  width: auto;
  min-height: 1.75rem;
  padding-inline: 0.55rem;
  white-space: nowrap;
}

.preset-adapter-summary-settings {
  border-top: 1px solid var(--SmartThemeBorderColor);
  padding-top: 0.75rem;
}

.preset-adapter-summary-panel > summary {
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  background-color: var(--black30a);
}

.preset-adapter-summary-setting-block {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.preset-adapter-summary-definition {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.35rem 0.65rem;
  margin: 0;
}

.preset-adapter-summary-definition dt {
  color: var(--SmartThemeEmColor);
}

.preset-adapter-summary-definition dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.preset-adapter-summary-error-list {
  margin: 0;
  padding-left: 1.2rem;
  color: var(--SmartThemeQuoteColor);
  white-space: pre-wrap;
}

.preset-adapter-summary-setting-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
  gap: 0.55rem;
}

.preset-adapter-summary-setting-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  color: var(--SmartThemeEmColor);
  font-size: 0.88rem;
}

.preset-adapter-summary-setting-grid select {
  width: 100%;
}

.preset-adapter-summary-inline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.preset-adapter-summary-inline-actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
}

.preset-adapter-summary-inline-actions .menu_button {
  width: auto;
  min-height: 2rem;
  padding-inline: 0.75rem;
}

.preset-adapter-summary-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
  gap: 0.45rem 0.75rem;
}

.preset-adapter-summary-checkbox-grid label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.preset-adapter-summary-start {
  flex-shrink: 0;
  justify-content: center;
  width: 100%;
  min-height: 2.75rem;
  margin-bottom: 1.25rem;
  font-size: 1rem;
  font-weight: 700;
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
