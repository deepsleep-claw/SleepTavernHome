<template>
  <section class="pa-selection-library">
    <div class="pa-selection-heading">
      <label for="pa-selection-preset">选项组预设</label>
      <span v-if="store.selection_modified">未保存</span>
      <button
        v-if="store.selection_missing.length"
        type="button"
        @click="notice = { title: '当前缺失选项', messages: store.selection_missing }"
      >
        {{ store.selection_missing.length }} 项不可用
      </button>
    </div>
    <div class="pa-selection-controls">
      <div ref="picker" class="pa-selection-picker" @keydown="onPickerKeydown">
        <button
          id="pa-selection-preset"
          ref="picker_trigger"
          type="button"
          class="pa-selection-trigger"
          aria-haspopup="dialog"
          aria-controls="pa-selection-options"
          :aria-expanded="picker_open"
          :disabled="disabled"
          @click="togglePicker"
          @keydown.down.prevent="openPicker()"
          @keydown.up.prevent="openPicker(true)"
        >
          <span>{{ displayed_selection_name }}</span>
          <i :class="picker_open ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'" aria-hidden="true"></i>
        </button>
        <div
          v-if="picker_open"
          id="pa-selection-options"
          class="pa-selection-options"
          role="dialog"
          aria-label="选择选项组预设"
        >
          <ul v-if="picker_items.length">
            <li v-for="item in picker_items" :key="item.preset.id" :data-selection-preset-id="item.preset.id">
              <button
                type="button"
                class="pa-selection-choice"
                :aria-pressed="item.preset.id === store.active_selection_preset?.id"
                :disabled="disabled || store.has_blocking_errors"
                @click="requestSwitch(item.preset)"
              >
                <strong>{{ item.preset.name }}</strong>
                <small v-if="item.missing">{{ item.missing }} 项不可用</small>
                <small v-else-if="item.preset.id === store.active_selection_preset?.id">当前选项组</small>
              </button>
              <button
                type="button"
                class="pa-selection-item-action"
                :aria-label="'重命名 ' + item.preset.name"
                title="重命名"
                :disabled="disabled"
                @click="openEditor('rename', item.preset)"
              >
                <i class="fa-solid fa-pen" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="pa-selection-item-action"
                :aria-label="'删除 ' + item.preset.name"
                title="删除"
                :disabled="disabled"
                @click="requestDelete(item.preset)"
              >
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
              </button>
            </li>
          </ul>
          <p v-else class="pa-selection-empty">还没有选项组预设，可以先新建一份。</p>
        </div>
      </div>
      <div class="preset-adapter-actions">
        <button type="button" :disabled="disabled || store.has_blocking_errors" @click="openEditor('create')">
          新建
        </button>
        <button
          type="button"
          :disabled="disabled || !store.active_selection_preset || store.has_blocking_errors"
          @click="store.saveSelectionPreset()"
        >
          保存
        </button>
        <button
          type="button"
          :disabled="disabled || !store.active_selection_preset"
          @click="store.exportSelectionPreset()"
        >
          导出
        </button>
        <button type="button" :disabled="disabled" @click="file_input?.click()">导入</button>
      </div>
    </div>
    <p v-if="store.selection_library_error" class="pa-selection-error">{{ store.selection_library_error }}</p>
    <input
      ref="file_input"
      class="pa-import-file-input"
      type="file"
      aria-hidden="true"
      tabindex="-1"
      @change="importFile"
    />

    <AdapterModal
      v-if="editor"
      :busy="store.is_applying"
      :title="
        editor.kind === 'create' ? '新建选项组预设' : editor.kind === 'rename' ? '重命名选项组预设' : '导入选项组预设'
      "
      @close="editor = undefined"
    >
      <form id="pa-selection-name-form" @submit.prevent="submitEditor">
        <label
          >名称<input v-model="editor.name" class="pa-modal-input" autofocus required :disabled="store.is_applying"
        /></label>
        <p v-if="name_error" class="pa-modal-error">{{ name_error }}</p>
      </form>
      <template #footer>
        <button type="button" @click="editor = undefined">取消</button>
        <button
          type="submit"
          form="pa-selection-name-form"
          class="pa-modal-primary"
          :disabled="store.is_applying || !!name_error || !editor.name.trim()"
        >
          确认
        </button>
      </template>
    </AdapterModal>
    <AdapterModal
      v-if="pending_switch"
      title="切换选项组预设"
      :busy="store.is_applying"
      @close="pending_switch = undefined"
    >
      <p>当前按钮组合有未保存的修改，是否切换到“{{ pending_switch.name }}”？</p>
      <template #footer>
        <button type="button" :disabled="store.is_applying" @click="pending_switch = undefined">取消</button>
        <button
          type="button"
          class="pa-modal-primary"
          :disabled="store.is_applying"
          @click="applyPreset(pending_switch.id)"
        >
          切换
        </button>
      </template>
    </AdapterModal>
    <AdapterModal
      v-if="pending_delete"
      title="删除选项组预设"
      :busy="store.is_applying"
      @close="pending_delete = undefined"
    >
      <p>确认删除“{{ pending_delete.name }}”？</p>
      <template #footer>
        <button type="button" @click="pending_delete = undefined">取消</button>
        <button type="button" class="pa-modal-primary" :disabled="store.is_applying" @click="deletePreset">删除</button>
      </template>
    </AdapterModal>
    <AdapterModal v-if="notice" :title="notice.title" @close="notice = undefined">
      <ul>
        <li v-for="(message, index) in notice.messages" :key="index">{{ message }}</li>
      </ul>
      <template #footer
        ><button type="button" class="pa-modal-primary" @click="notice = undefined">知道了</button></template
      >
    </AdapterModal>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AdapterModal from './AdapterModal.vue';
import { readImportFile } from './import-file';
import { resolveSelections, type SelectionContent, type SelectionPreset } from './selection-presets';
import { SCRIPT_NAME, usePresetAdapterStore } from './store';

const store = usePresetAdapterStore();
const disabled = computed(() => store.is_applying || !!store.selection_library_error);
const displayed_selection_name = computed(() => {
  const active = store.active_selection_preset;
  return active ? active.name + (store.selection_modified ? '（当前已修改）' : '') : '选择选项组预设';
});
const picker = ref<HTMLElement>();
const picker_trigger = ref<HTMLButtonElement>();
const picker_open = ref(false);
const picker_items = computed(() =>
  store.selection_library.presets.map(preset => ({
    preset,
    missing: resolveSelections(preset.selections, store.groups).missing.length,
  })),
);
const file_input = ref<HTMLInputElement>();
const editor = ref<{ kind: 'create' | 'rename' | 'import'; name: string; id?: string; imported?: SelectionContent }>();
const pending_switch = ref<SelectionPreset>();
const pending_delete = ref<SelectionPreset>();
const notice = ref<{ title: string; messages: string[] }>();
const name_error = computed(() => {
  const value = editor.value;
  if (!value) return '';
  return store.selection_library.presets.some(preset => preset.name === value.name.trim() && preset.id !== value.id)
    ? '已有同名预设，请使用其他名称。'
    : '';
});
function openEditor(kind: 'create' | 'rename', selected?: SelectionPreset) {
  if (kind === 'rename' && !selected) return;
  closePicker(kind === 'rename');
  editor.value = {
    kind,
    name: kind === 'rename' ? (selected?.name ?? '') : '',
    id: kind === 'rename' ? selected?.id : undefined,
  };
}
function submitEditor() {
  const value = editor.value;
  if (!value || name_error.value || !value.name.trim()) return;
  const success =
    value.kind === 'rename'
      ? store.renameSelectionPreset(value.id!, value.name)
      : store.createSelectionPreset(value.name, value.imported);
  if (success) editor.value = undefined;
}
function requestSwitch(preset: SelectionPreset) {
  closePicker(true);
  if (preset.id === store.active_selection_preset?.id && !store.selection_modified) return;
  if (store.selection_modified) pending_switch.value = preset;
  else void applyPreset(preset.id);
}
async function applyPreset(id: string) {
  const result = await store.applySelectionPreset(id);
  pending_switch.value = undefined;
  if (result) notice.value = result;
}
function deletePreset() {
  if (pending_delete.value && store.deleteSelectionPreset(pending_delete.value.id)) pending_delete.value = undefined;
}
function requestDelete(preset: SelectionPreset) {
  closePicker(true);
  pending_delete.value = preset;
}
function closePicker(restore_focus = false) {
  picker_open.value = false;
  if (restore_focus) picker_trigger.value?.focus();
}
async function openPicker(last = false) {
  if (disabled.value) return;
  picker_open.value = true;
  await nextTick();
  const choices = [...(picker.value?.querySelectorAll<HTMLButtonElement>('.pa-selection-choice:not(:disabled)') ?? [])];
  const selected = choices.find(choice => choice.getAttribute('aria-pressed') === 'true');
  (last ? choices.at(-1) : (selected ?? choices[0]))?.focus();
}
function togglePicker() {
  if (picker_open.value) closePicker();
  else void openPicker();
}
function onPickerKeydown(event: KeyboardEvent) {
  if (!picker_open.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closePicker(true);
    return;
  }
  const target = event.target as HTMLElement;
  if (!target.classList.contains('pa-selection-choice') || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
    return;
  event.preventDefault();
  const choices = [...picker.value!.querySelectorAll<HTMLButtonElement>('.pa-selection-choice:not(:disabled)')];
  const index = choices.indexOf(target as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? choices.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
  choices[next]?.focus();
}
function onOutsidePointerDown(event: PointerEvent) {
  if (picker_open.value && event.target && !picker.value?.contains(event.target as Node)) closePicker();
}
watch(disabled, value => {
  if (value) closePicker();
});
onMounted(() => picker.value?.ownerDocument.addEventListener('pointerdown', onOutsidePointerDown));
onBeforeUnmount(() => picker.value?.ownerDocument.removeEventListener('pointerdown', onOutsidePointerDown));
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  try {
    if (!file) return;
    const imported = store.readSelectionPresetFile(await readImportFile(file));
    if (imported) editor.value = { kind: 'import', name: imported.name, imported };
  } catch (error) {
    toastr.error('读取选项组预设文件失败：' + String(error), SCRIPT_NAME);
  } finally {
    input.value = '';
  }
}
</script>

<style>
.preset-adapter-root .pa-import-file-input {
  position: fixed;
  top: 0;
  left: -10000px;
  width: 1px;
  height: 1px;
  min-height: 0;
  padding: 0;
  border: 0;
}
.preset-adapter-root .pa-selection-library {
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-card-radius);
  padding: 0.65rem;
  background: var(--pa-surface-soft);
}
.preset-adapter-root .pa-selection-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}
.preset-adapter-root .pa-selection-heading label {
  font-weight: 700;
}
.preset-adapter-root .pa-selection-heading > span {
  color: var(--pa-highlight-text);
  font-size: 0.8rem;
}
.preset-adapter-root .pa-selection-heading button {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--pa-highlight-text);
  font-size: 0.8rem;
}
.preset-adapter-root .pa-selection-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.preset-adapter-root .pa-selection-picker {
  position: relative;
  flex: 1 1 12rem;
  min-width: 0;
  max-width: 100%;
}
.preset-adapter-root .pa-selection-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  width: 100%;
  min-height: 2.2rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  background: var(--pa-ink-soft);
  color: var(--pa-text);
  -webkit-text-fill-color: currentColor;
  padding: 0.4rem 0.6rem;
  text-align: left;
  cursor: pointer;
}
.preset-adapter-root .pa-selection-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preset-adapter-root .pa-selection-picker button:focus-visible {
  outline: 2px solid var(--pa-gold);
  outline-offset: -2px;
}
.preset-adapter-root .pa-selection-options {
  position: absolute;
  z-index: 150;
  top: calc(100% + 0.3rem);
  right: 0;
  left: 0;
  max-height: 20rem;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--pa-border-strong);
  border-radius: var(--pa-control-radius);
  padding: 0.3rem;
  background: var(--pa-popover-background, var(--pa-ink));
  color: var(--pa-text);
  box-shadow: 0 0.6rem 1.5rem var(--pa-shadow);
}
.preset-adapter-root .pa-selection-options ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.preset-adapter-root .pa-selection-options li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.25rem;
  border-radius: var(--pa-control-radius);
}
.preset-adapter-root .pa-selection-options li:hover {
  background: var(--pa-surface-raised);
}
.preset-adapter-root .pa-selection-options .pa-selection-choice {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
  min-height: 2.5rem;
  border: 1px solid transparent;
  padding: 0.45rem 0.5rem;
  background: transparent;
  color: var(--pa-text);
  -webkit-text-fill-color: currentColor;
  text-align: left;
}
.preset-adapter-root .pa-selection-choice[aria-pressed='true'] {
  color: var(--pa-highlight-text);
  background: var(--pa-highlight-soft);
}
.preset-adapter-root .pa-selection-choice strong {
  overflow-wrap: anywhere;
  color: inherit;
}
.preset-adapter-root .pa-selection-choice small {
  color: var(--pa-muted);
  font-size: 0.75rem;
}
.preset-adapter-root .pa-selection-item-action {
  width: 2.1rem;
  min-height: 2.1rem;
  padding: 0.3rem;
  border: 1px solid transparent;
  background: transparent;
  color: var(--pa-text);
}
.preset-adapter-root .pa-selection-empty {
  margin: 0;
  padding: 0.5rem;
  color: var(--pa-muted);
}
.preset-adapter-root .pa-selection-error {
  margin: 0.5rem 0 0;
  color: var(--pa-accent-text);
  overflow-wrap: anywhere;
}
</style>
