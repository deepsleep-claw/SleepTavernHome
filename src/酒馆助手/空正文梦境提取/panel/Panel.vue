<template>
  <template v-if="store.should_enable">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>空正文梦境提取</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>

      <div class="inline-drawer-content">
        <label class="dream-extraction-field">
          <span>开头正则表达式</span>
          <input
            v-model="store.settings.start_regex"
            class="text_pole wide100p"
            type="text"
            placeholder="留空则不提取"
          />
        </label>

        <label class="dream-extraction-field">
          <span>结尾正则表达式</span>
          <input
            v-model="store.settings.end_regex"
            class="text_pole wide100p"
            type="text"
            placeholder="留空则提取到最末尾"
          />
        </label>

        <div class="dream-extraction-actions">
          <button
            type="button"
            class="menu_button"
            title="重置为默认正则"
            aria-label="重置为默认正则"
            @click="resetSettings"
          >
            <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { SCRIPT_NAME, useDreamExtractionStore } from '../store';

const store = useDreamExtractionStore();

async function resetSettings() {
  const confirmed = await SillyTavern.callGenericPopup(
    '确定将提取正则重置为默认值吗？',
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirmed !== true && confirmed !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
    return;
  }
  store.resetSettings();
  toastr.info('已重置提取正则。', SCRIPT_NAME);
}
</script>

<style scoped>
.dream-extraction-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}

.dream-extraction-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.dream-extraction-actions .menu_button {
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
