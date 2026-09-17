<template>
  <details
    ref="menu"
    class="pa-import-menu"
    @pointerenter="openOnHover"
    @pointerleave="closeMenu"
    @keydown.esc.stop.prevent="closeMenu"
  >
    <summary :aria-disabled="disabled" :tabindex="disabled ? -1 : 0" @click="preventDisabled">
      <i class="fa-solid fa-arrow-down" aria-hidden="true"></i> 导入
      <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    </summary>
    <div class="pa-import-menu-items">
      <button type="button" :disabled="disabled" @click="openFile">从文件导入</button>
      <button type="button" :disabled="disabled" @click="openPresetPicker">从旧预设导入</button>
    </div>
  </details>
  <input ref="file_input" hidden type="file" accept="application/json,.json" @change="importFile" />
  <AdapterModal v-if="picker_open" title="从旧预设导入" :busy="parsing" @close="picker_open = false">
    <label
      >选择来源预设
      <select v-model="source_name" class="pa-modal-input" autofocus :disabled="parsing">
        <option value="" disabled>请选择酒馆预设</option>
        <option v-for="name in preset_names" :key="name" :value="name">{{ name }}</option>
      </select>
    </label>
    <p v-if="preset_names.length === 0" class="pa-modal-error">没有可读取的酒馆预设。</p>
    <template #footer>
      <button type="button" :disabled="parsing" @click="picker_open = false">取消</button>
      <button type="button" class="pa-modal-primary" :disabled="parsing || !source_name" @click="parsePreset">
        {{ parsing ? '解析中…' : '解析' }}
      </button>
    </template>
  </AdapterModal>
  <AdapterModal v-if="review" :title="review.title" wide :busy="store.is_applying" @close="store.closeReviewPanel()">
    <div class="pa-import-context">
      <p>来源：{{ review.source_name }}</p>
      <p>导入到：{{ review.target_name }}</p>
      <p>已选 {{ store.selected_import_count }} 项 · 导入后保存当前酒馆预设</p>
    </div>
    <details v-if="review.source_warnings.length" class="pa-import-warnings">
      <summary>解析提示（{{ review.source_warnings.length }}）</summary>
      <ul>
        <li v-for="(warning, index) in review.source_warnings" :key="index">{{ warning }}</li>
      </ul>
    </details>
    <p v-if="store.import_review_groups.length === 0">没有解析到可导入的选项。</p>
    <section v-for="group in store.import_review_groups" :key="group.id" class="pa-import-group">
      <label class="pa-import-group-heading">
        <input
          type="checkbox"
          :checked="groupChecked(group.items)"
          :indeterminate="groupPartial(group.items)"
          :disabled="store.is_applying || group.items.every(item => item.disabled)"
          @change="
            store.setImportSelection(
              group.items.map(item => item.key),
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        <strong>{{ group.label }}</strong
        ><small>{{ group.items.length }} 项</small>
      </label>
      <article
        v-for="item in group.items"
        :key="item.key"
        class="pa-import-item"
        :class="{ 'pa-import-item-selected': isSelected(item.key) }"
      >
        <label class="pa-import-item-label">
          <input
            type="checkbox"
            :checked="isSelected(item.key)"
            :disabled="store.is_applying || item.disabled"
            @change="store.setImportSelection([item.key], ($event.target as HTMLInputElement).checked)"
          />
          <span class="pa-import-badge" :class="'pa-import-badge-' + item.action">{{ item.action_label }}</span>
          <strong>{{ item.name }}</strong>
        </label>
        <p v-if="item.issue" class="pa-modal-error">{{ item.issue }}</p>
        <details>
          <summary>内容预览</summary>
          <pre>{{ item.preview }}</pre>
        </details>
      </article>
    </section>
    <template #footer>
      <span class="pa-import-count">已选 {{ store.selected_import_count }} 项</span>
      <button type="button" :disabled="store.is_applying" @click="store.closeReviewPanel()">取消</button>
      <button
        type="button"
        class="pa-modal-primary"
        :disabled="store.is_applying || store.selected_import_count === 0"
        @click="store.confirmImportReview()"
      >
        {{ store.is_applying ? '导入中…' : '导入' }}
      </button>
    </template>
  </AdapterModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import AdapterModal from './AdapterModal.vue';
import { SCRIPT_NAME, usePresetAdapterStore } from './store';

const store = usePresetAdapterStore();
const menu = ref<HTMLDetailsElement>();
const file_input = ref<HTMLInputElement>();
const picker_open = ref(false);
const preset_names = ref<string[]>([]);
const source_name = ref('');
const parsing = ref(false);
const disabled = computed(() => store.is_applying || store.has_blocking_errors);
const review = computed(() => (store.review_panel?.kind === 'import' ? store.review_panel : undefined));
const isSelected = (key: string) => review.value?.selected_keys.includes(key) ?? false;
type Item = { key: string; disabled: boolean };
function groupChecked(items: Item[]) {
  const enabled = items.filter(item => !item.disabled);
  return enabled.length > 0 && enabled.every(item => isSelected(item.key));
}
function groupPartial(items: Item[]) {
  return items.some(item => isSelected(item.key)) && !groupChecked(items);
}
function closeMenu() {
  if (menu.value) menu.value.open = false;
}
function openOnHover(event: PointerEvent) {
  if (event.pointerType === 'mouse' && menu.value && !disabled.value) menu.value.open = true;
}
function preventDisabled(event: Event) {
  if (disabled.value) event.preventDefault();
}
function openFile() {
  closeMenu();
  file_input.value?.click();
}
function openPresetPicker() {
  closeMenu();
  preset_names.value = store.getImportPresetNames();
  source_name.value = '';
  picker_open.value = true;
}
async function parsePreset() {
  parsing.value = true;
  try {
    await nextTick();
    if (store.importFromPreset(source_name.value)) picker_open.value = false;
  } finally {
    parsing.value = false;
  }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  try {
    const file = input.files?.[0];
    if (file) await store.importPresetSettings(await file.text(), file.name);
  } catch (error) {
    toastr.error('读取设置文件失败：' + String(error), SCRIPT_NAME);
  } finally {
    input.value = '';
  }
}
</script>

<style>
.preset-adapter-root .pa-import-menu {
  position: relative;
}
.preset-adapter-root .pa-import-menu > summary {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2.2rem;
  box-sizing: border-box;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  padding: 0.35rem 0.65rem;
  background: var(--pa-surface-soft);
  color: var(--pa-text);
  cursor: pointer;
  list-style: none;
}
.preset-adapter-root .pa-import-menu > summary::-webkit-details-marker {
  display: none;
}
.preset-adapter-root .pa-import-menu > summary[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}
.preset-adapter-root .pa-import-menu > summary:focus-visible {
  outline: 2px solid var(--pa-gold);
}
.preset-adapter-root .pa-import-menu[open] > summary {
  border-color: var(--pa-gold);
}
.preset-adapter-root .pa-import-menu-items {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  min-width: 10rem;
  padding: 0.35rem;
  border: 1px solid var(--pa-border-strong);
  border-radius: var(--pa-control-radius);
  background: var(--pa-surface-raised);
  box-shadow: 0 0.7rem 1.5rem var(--pa-shadow);
}
.preset-adapter-root .pa-import-menu-items button {
  width: 100%;
  justify-content: flex-start;
  white-space: nowrap;
}
.pa-modal-panel .pa-import-context {
  color: var(--pa-muted);
  font-size: 0.85rem;
}
.pa-modal-panel .pa-import-warnings {
  border: 1px solid var(--pa-highlight-border);
  border-radius: var(--pa-control-radius);
  padding: 0.55rem;
  margin-bottom: 0.6rem;
}
.pa-modal-panel .pa-import-group {
  display: grid;
  gap: 0.4rem;
  margin-top: 0.8rem;
}
.pa-modal-panel .pa-import-group-heading,
.pa-modal-panel .pa-import-item-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  cursor: pointer;
}
.pa-modal-panel .pa-import-group-heading {
  padding: 0.35rem 0;
}
.pa-modal-panel .pa-import-group-heading small {
  margin-left: auto;
  color: var(--pa-muted);
}
.pa-modal-panel .pa-import-item {
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  padding: 0.6rem;
  background: var(--pa-surface-soft);
}
.pa-modal-panel .pa-import-item-selected {
  border-color: var(--pa-gold);
  background: color-mix(in srgb, var(--pa-gold) 12%, var(--pa-surface-soft));
  box-shadow: inset 3px 0 0 var(--pa-gold);
}
.pa-modal-panel .pa-import-item-label strong {
  min-width: 0;
  overflow-wrap: anywhere;
}
.pa-modal-panel .pa-import-badge {
  flex: 0 0 auto;
  border: 1px solid var(--pa-border);
  border-radius: 999px;
  padding: 0.05rem 0.35rem;
  color: var(--pa-muted);
  font-size: 0.75rem;
}
.pa-modal-panel .pa-import-badge-create {
  border-color: var(--pa-coral);
  color: var(--pa-accent-text);
}
.pa-modal-panel .pa-import-badge-overwrite,
.pa-modal-panel .pa-import-badge-append {
  border-color: var(--pa-gold);
  color: var(--pa-highlight-text);
}
.pa-modal-panel .pa-import-item details {
  margin-top: 0.5rem;
  font-size: 0.85rem;
}
.pa-modal-panel .pa-import-item summary,
.pa-modal-panel .pa-import-warnings summary {
  cursor: pointer;
}
.pa-modal-panel .pa-import-item pre {
  max-height: 14rem;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 0.5rem;
  border: 1px solid var(--pa-border);
  border-radius: 6px;
  background: var(--pa-ink-soft);
  color: var(--pa-text);
  font: inherit;
}
.pa-modal-panel .pa-import-count {
  margin-right: auto;
  color: var(--pa-muted);
  font-size: 0.85rem;
}
</style>
