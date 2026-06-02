<template>
  <template v-if="store.should_enable">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>格式补全</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>

      <div class="inline-drawer-content">
        <label class="format-completion-field">
          <span>补全提示词</span>
          <textarea
            v-model="store.append_prompt"
            class="text_pole wide100p format-completion-textarea"
            rows="8"
          ></textarea>
        </label>
        <div class="format-completion-actions">
          <button
            type="button"
            class="menu_button"
            title="重置为默认提示词"
            aria-label="重置为默认提示词"
            @click="resetAppendPrompt"
          >
            <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
          </button>
        </div>
        <label class="format-completion-checkbox">
          <input v-model="store.should_intercept_tail_user_prompt" type="checkbox" />
          <span>启用末尾用户提示词拦截</span>
        </label>
        <label class="format-completion-checkbox">
          <input v-model="store.should_stream_format_completion" type="checkbox" />
          <span>启用流式格式补全</span>
        </label>
        <label class="format-completion-field">
          <span>拦截提示词尾</span>
          <input v-model="store.intercept_tail_prompt" type="text" class="text_pole wide100p" />
        </label>
        <label class="format-completion-field">
          <span>插入格式前缀匹配</span>
          <input v-model="store.insert_format_prefix" type="text" class="text_pole wide100p" />
        </label>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { FORMAT_COMPLETION_NAME, useFormatCompletionStore } from '../store';

const store = useFormatCompletionStore();

async function resetAppendPrompt() {
  const confirmed = await SillyTavern.callGenericPopup(
    '确定将补全提示词重置为默认值吗？',
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirmed !== true && confirmed !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
    return;
  }
  store.resetAppendPrompt();
  toastr.info('已重置补全提示词。', FORMAT_COMPLETION_NAME);
}
</script>

<style scoped>
.format-completion-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.format-completion-checkbox {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.75rem;
}

.format-completion-textarea {
  min-height: 10rem;
  resize: vertical;
}

.format-completion-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.format-completion-actions .menu_button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2em;
  height: 2em;
  padding: 0;
  white-space: nowrap;
}
</style>
