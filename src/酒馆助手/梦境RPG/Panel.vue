<template>
  <div class="inline-drawer drpg-settings">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>梦境RPG</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="drpg-settings-fields">
        <label class="drpg-setting-row">
          <input v-model="store.settings.enabled" type="checkbox" />
          <span><b>启用 RPG 交互</b><small>记录剧情选项，在发送或编辑行动时补齐判定。</small></span>
        </label>
        <label class="drpg-setting-row">
          <input v-model="store.settings.reuse_rolls" type="checkbox" />
          <span><b>复用相同行动的骰点</b><small>相同场景、语境和行动使用已记录的点数。</small></span>
        </label>
        <label class="drpg-setting-row">
          <input v-model="store.settings.preview_results" type="checkbox" />
          <span><b>提前查看结果</b><small>发送行动后，在玩家消息中显示骰点和检定结果。</small></span>
        </label>
        <label class="drpg-setting-row">
          <input v-model="store.settings.allow_secret_reveal" type="checkbox" />
          <span><b>允许显示暗骰</b><small>临时查看选项难度，或点击消息中的遮罩查看暗骰结果。</small></span>
        </label>
        <label class="drpg-theme-field">
          <span>界面主题</span>
          <select v-model="store.settings.theme" class="text_pole">
            <option value="auto">跟随酒馆</option>
            <option value="light">暖纸亮色</option>
            <option value="dark">墨蓝暗色</option>
          </select>
        </label>
        <p v-if="store.error" class="drpg-settings-error" role="alert">{{ store.error }}</p>
        <small class="drpg-settings-hint">设置自动保存</small>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRpgStore } from './settings';

const store = useRpgStore();
</script>

<style scoped>
.drpg-settings-fields {
  display: grid;
  gap: 0.9rem;
  padding: 0.6rem 0;
}
.drpg-setting-row {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  cursor: pointer;
}
.drpg-setting-row input {
  margin-top: 0.3rem;
}
.drpg-setting-row b,
.drpg-setting-row small {
  display: block;
}
.drpg-setting-row small,
.drpg-settings-hint {
  font-size: 0.85em;
  opacity: 0.72;
  line-height: 1.6;
}
.drpg-theme-field {
  display: grid;
  gap: 0.35rem;
}
.drpg-theme-field select {
  width: 100%;
  margin: 0;
}
.drpg-settings-error {
  margin: 0;
  color: #e9a495;
  overflow-wrap: anywhere;
}
</style>
