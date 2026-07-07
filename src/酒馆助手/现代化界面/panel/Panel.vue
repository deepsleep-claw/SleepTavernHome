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
          <span>滑出面板最大宽度</span>
          <input
            v-model.number="store.settings.overlayPanelWidth"
            class="text_pole"
            type="number"
            min="720"
            max="1080"
            step="20"
          />
        </label>

        <div class="modern-layout-actions">
          <button type="button" class="menu_button" title="重置现代化界面设置" @click="resetSettings">
            <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
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
