<template>
  <template v-if="store.should_enable">
    <div class="inline-drawer modern-layout-panel">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>{{ SCRIPT_NAME }}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>

      <div class="inline-drawer-content">
        <label class="checkbox_label modern-layout-checkbox">
          <input v-model="store.settings.enabled" type="checkbox" class="checkbox" />
          <span>启用现代化界面</span>
        </label>

        <label class="checkbox_label modern-layout-checkbox">
          <input v-model="store.settings.desktopTwoColumn" type="checkbox" class="checkbox" />
          <span>宽屏启用两栏与滑出面板</span>
        </label>

        <label class="modern-layout-field">
          <span>左侧栏宽度</span>
          <input
            v-model.number="store.settings.leftSidebarWidth"
            class="text_pole"
            type="number"
            min="320"
            max="460"
            step="4"
          />
        </label>

        <label class="modern-layout-field">
          <span>滑出面板偏好宽度</span>
          <input
            v-model.number="store.settings.overlayPanelWidth"
            class="text_pole"
            type="number"
            min="720"
            step="20"
          />
        </label>

        <label class="modern-layout-field">
          <span>主聊天最大宽度</span>
          <input
            v-model.number="store.settings.mainChatMaxWidth"
            class="text_pole"
            type="number"
            min="0"
            step="20"
          />
        </label>
        <small class="modern-layout-hint">0 表示不限制宽度。</small>

        <label class="checkbox_label modern-layout-checkbox">
          <input v-model="store.settings.reduceMotion" type="checkbox" class="checkbox" />
          <span>减弱动态效果</span>
        </label>

        <label class="checkbox_label modern-layout-checkbox">
          <input v-model="store.settings.reduceAdvancedEffects" type="checkbox" class="checkbox" />
          <span>减少高级美化</span>
        </label>

        <label class="checkbox_label modern-layout-checkbox">
          <input v-model="store.settings.modernWorldInfoEditor" type="checkbox" class="checkbox" />
          <span>启用现代世界书编辑器</span>
        </label>

        <div class="modern-layout-actions">
          <button type="button" class="menu_button" title="重置现代化界面设置" @click="resetSettings">
            <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { SCRIPT_NAME, useModernLayoutStore } from '../store';

const store = useModernLayoutStore();

async function resetSettings() {
  const confirmed = await SillyTavern.callGenericPopup(
    '确定将现代化界面设置重置为默认值吗？',
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirmed !== true && confirmed !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
    return;
  }
  store.resetSettings();
  toastr.info('已重置现代化界面设置。', SCRIPT_NAME);
}
</script>

<style scoped>
.modern-layout-panel .inline-drawer-content {
  padding: 0.5rem 0;
}

.modern-layout-checkbox {
  justify-content: flex-start;
  margin: 0.35rem 0;
}

.modern-layout-field {
  display: grid;
  grid-template-columns: minmax(7em, 1fr) minmax(7em, 9em);
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.modern-layout-field .text_pole {
  width: 100%;
}

.modern-layout-hint {
  display: block;
  margin: -0.2rem 0 0.55rem;
  opacity: 0.75;
}

.modern-layout-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.75rem;
}

.modern-layout-actions .menu_button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2em;
  height: 2em;
  padding: 0;
}
</style>
