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
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { useFormatCompletionStore } from '../store';

const store = useFormatCompletionStore();
</script>

<style scoped>
.format-completion-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.format-completion-textarea {
  min-height: 10rem;
  resize: vertical;
}
</style>
