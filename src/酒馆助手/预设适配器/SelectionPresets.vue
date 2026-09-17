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
      <select id="pa-selection-preset" :value="displayed_selection_id" :disabled="disabled" @change="requestSwitch">
        <option value="" disabled>
          {{ store.selection_modified ? store.active_selection_preset?.name + '（当前已修改）' : '选择选项组预设' }}
        </option>
        <option v-for="preset in store.selection_library.presets" :key="preset.id" :value="preset.id">
          {{ preset.name }}
        </option>
      </select>
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
        <button type="button" :disabled="disabled || !store.active_selection_preset" @click="openEditor('rename')">
          重命名
        </button>
        <button
          type="button"
          :disabled="disabled || !store.active_selection_preset"
          @click="pending_delete = store.active_selection_preset"
        >
          删除
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
    <input ref="file_input" hidden type="file" accept="application/json,.json" @change="importFile" />

    <AdapterModal
      v-if="editor"
      :title="
        editor.kind === 'create' ? '新建选项组预设' : editor.kind === 'rename' ? '重命名选项组预设' : '导入选项组预设'
      "
      @close="editor = undefined"
    >
      <form id="pa-selection-name-form" @submit.prevent="submitEditor">
        <label>名称<input v-model="editor.name" class="pa-modal-input" autofocus required /></label>
        <p v-if="name_error" class="pa-modal-error">{{ name_error }}</p>
      </form>
      <template #footer>
        <button type="button" @click="editor = undefined">取消</button>
        <button
          type="submit"
          form="pa-selection-name-form"
          class="pa-modal-primary"
          :disabled="!!name_error || !editor.name.trim()"
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
    <AdapterModal v-if="pending_delete" title="删除选项组预设" @close="pending_delete = undefined">
      <p>确认删除“{{ pending_delete.name }}”？</p>
      <template #footer>
        <button type="button" @click="pending_delete = undefined">取消</button>
        <button type="button" class="pa-modal-primary" @click="deletePreset">删除</button>
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
import { computed, ref } from 'vue';
import AdapterModal from './AdapterModal.vue';
import type { SelectionContent, SelectionPreset } from './selection-presets';
import { SCRIPT_NAME, usePresetAdapterStore } from './store';

const store = usePresetAdapterStore();
const disabled = computed(() => store.is_applying || !!store.selection_library_error);
const displayed_selection_id = computed(() =>
  store.selection_modified ? '' : (store.active_selection_preset?.id ?? ''),
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
function openEditor(kind: 'create' | 'rename') {
  const selected = store.active_selection_preset;
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
function requestSwitch(event: Event) {
  const input = event.target as HTMLSelectElement;
  const preset = store.selection_library.presets.find(item => item.id === input.value);
  input.value = displayed_selection_id.value;
  if (!preset || (preset.id === store.active_selection_preset?.id && !store.selection_modified)) return;
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
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  try {
    if (!file) return;
    const imported = store.readSelectionPresetFile(await file.text());
    if (imported) editor.value = { kind: 'import', name: imported.name, imported };
  } catch (error) {
    toastr.error('读取选项组预设文件失败：' + String(error), SCRIPT_NAME);
  } finally {
    input.value = '';
  }
}
</script>

<style>
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
.preset-adapter-root .pa-selection-controls select {
  flex: 1 1 12rem;
  min-width: 0;
  max-width: 100%;
  min-height: 2.2rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius);
  background: var(--pa-ink-soft);
  color: var(--pa-text);
  padding: 0.4rem 0.6rem;
}
.preset-adapter-root .pa-selection-controls select:focus-visible {
  outline: 2px solid var(--pa-gold);
}
.preset-adapter-root .pa-selection-error {
  margin: 0.5rem 0 0;
  color: var(--pa-accent-text);
  overflow-wrap: anywhere;
}
</style>
