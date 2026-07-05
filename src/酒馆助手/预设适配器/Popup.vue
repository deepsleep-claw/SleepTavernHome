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
  gap: 0.7rem;
  color: var(--SmartThemeBodyColor);
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
}
</style>
