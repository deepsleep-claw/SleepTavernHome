<template>
  <AdapterModal
    v-if="store.prompt_editor"
    :title="store.prompt_editor.original ? '编辑文风' : '新建文风'"
    wide
    :busy="store.is_applying"
    @close="store.closePromptEditor()"
  >
    <div class="pa-prompt-editor">
      <label>名称<input v-model="store.prompt_editor.name" autofocus :disabled="store.is_applying" /></label>
      <label
        >文风内容<textarea v-model="store.prompt_editor.body" rows="12" :disabled="store.is_applying"></textarea>
      </label>
      <small>保存到：{{ store.prompt_editor.preset_name }}</small>
      <div v-if="confirm_delete" class="pa-prompt-delete-confirm" role="alert">
        <p>删除“{{ store.prompt_editor.original?.name }}”？</p>
        <button type="button" :disabled="store.is_applying" @click="confirm_delete = false">返回编辑</button>
        <button type="button" :disabled="store.is_applying" @click="store.deleteManagedPrompt()">确认删除</button>
      </div>
      <p v-if="store.prompt_editor_error" class="pa-modal-error" role="alert">{{ store.prompt_editor_error }}</p>
    </div>
    <template #footer>
      <button
        v-if="store.prompt_editor.original"
        type="button"
        class="pa-prompt-delete"
        :disabled="store.is_applying"
        @click="confirm_delete = true"
      >
        删除文风
      </button>
      <span class="pa-prompt-editor-spacer"></span>
      <button type="button" :disabled="store.is_applying" @click="store.closePromptEditor()">取消</button>
      <button
        type="button"
        class="pa-modal-primary"
        :disabled="
          store.is_applying || !store.prompt_editor.name.trim() || !store.prompt_editor.body.trim() || confirm_delete
        "
        @click="store.saveManagedPrompt()"
      >
        {{ store.is_applying ? '保存中…' : '保存' }}
      </button>
    </template>
  </AdapterModal>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import AdapterModal from './AdapterModal.vue';
import { usePresetAdapterStore } from './store';
const store = usePresetAdapterStore();
const confirm_delete = ref(false);
</script>

<style>
.pa-prompt-editor {
  display: grid;
  gap: 0.8rem;
}
.pa-prompt-editor label {
  display: grid;
  gap: 0.4rem;
}
.pa-prompt-editor input,
.pa-prompt-editor textarea {
  box-sizing: border-box;
  width: 100%;
}
.pa-prompt-editor textarea {
  resize: vertical;
  padding: 0.65rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius, 8px);
  background: var(--pa-surface-soft);
  color: var(--pa-text);
  font: inherit;
  line-height: 1.6;
}
.pa-prompt-editor textarea:focus-visible {
  outline: 2px solid var(--pa-gold);
  outline-offset: 2px;
}
.pa-prompt-editor small {
  color: var(--pa-muted);
}
.pa-prompt-editor-spacer {
  flex: 1;
}
.pa-modal-panel .pa-prompt-delete,
.pa-prompt-delete-confirm {
  color: var(--pa-accent-text);
}
.pa-prompt-delete-confirm {
  padding: 0.7rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius, 8px);
}
.pa-prompt-delete-confirm button + button {
  margin-left: 0.5rem;
}
</style>
