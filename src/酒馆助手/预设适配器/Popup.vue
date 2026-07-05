<template>
  <div class="preset-adapter-root">
    <header class="preset-adapter-header">
      <div>
        <h3>{{ store.title }}</h3>
        <p v-if="store.description" class="preset-adapter-description">{{ store.description }}</p>
        <span class="preset-adapter-preset">当前预设：{{ store.loaded_preset_name }}</span>
      </div>
      <button type="button" class="menu_button preset-adapter-icon-button" title="刷新" @click="store.refresh()">
        <i class="fa-solid fa-rotate" aria-hidden="true"></i>
      </button>
    </header>

    <div class="preset-adapter-stats">
      <span>{{ store.groups.length }} 组</span>
      <span>{{ option_count }} 个选项</span>
    </div>

    <section v-if="store.errors.length > 0" class="preset-adapter-errors">
      <strong>配置错误</strong>
      <ul>
        <li v-for="error in store.errors" :key="error">{{ error }}</li>
      </ul>
    </section>

    <div v-if="store.groups.length === 0" class="preset-adapter-empty">未配置选项组</div>

    <section v-for="group in store.groups" :key="group.id" class="preset-adapter-group">
      <div class="preset-adapter-group-header">
        <div class="preset-adapter-group-title">
          <h4>{{ group.label }}</h4>
          <p v-if="group.description" class="preset-adapter-description">{{ group.description }}</p>
        </div>
        <span>{{ group.mode_label }}</span>
      </div>

      <div class="preset-adapter-options" :class="`preset-adapter-options-${group.layout}`">
        <button
          v-for="option in group.options"
          :key="option.id"
          type="button"
          class="preset-adapter-option"
          :class="`preset-adapter-option-${option.status}`"
          :disabled="store.is_applying || store.has_blocking_errors || option.status === 'unmatched'"
          :title="option.matched_summary"
          @click="store.applyOption(group.id, option.id)"
        >
          <span class="preset-adapter-option-main">
            <i :class="option.status_icon_class" aria-hidden="true"></i>
            <span class="preset-adapter-option-title">
              <span>{{ option.label }}</span>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { usePresetAdapterStore } from './store';

const store = usePresetAdapterStore();
const option_count = computed(() => store.groups.reduce((total, group) => total + group.options.length, 0));
</script>

<style>
.preset-adapter-floating-window {
  position: fixed;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  box-shadow: 0 12px 36px var(--black70a);
  background-color: color-mix(in srgb, var(--SmartThemeBlurTintColor) 92%, var(--black100) 8%);
  color: var(--SmartThemeBodyColor);
}

.preset-adapter-floating-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  min-height: 2.55rem;
  border-bottom: 1px solid var(--SmartThemeBorderColor);
  padding: 0.25rem 0.4rem 0.25rem 0.75rem;
  background-color: var(--black30a);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.preset-adapter-floating-titlebar:active {
  cursor: grabbing;
}

.preset-adapter-floating-title {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 0.5rem;
  font-weight: 700;
}

.preset-adapter-floating-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-floating-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2em;
  height: 2em;
  padding: 0;
}

.preset-adapter-floating-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0.75rem;
  scrollbar-gutter: stable;
}

.preset-adapter-floating-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1.15rem;
  height: 1.15rem;
  cursor: nwse-resize;
  touch-action: none;
}

.preset-adapter-floating-resize::after {
  position: absolute;
  right: 0.25rem;
  bottom: 0.25rem;
  width: 0.55rem;
  height: 0.55rem;
  border-right: 2px solid var(--SmartThemeEmColor);
  border-bottom: 2px solid var(--SmartThemeEmColor);
  content: '';
  opacity: 0.8;
}

@media (max-width: 720px) {
  .preset-adapter-floating-body {
    padding: 0.6rem;
  }

  .preset-adapter-floating-titlebar {
    min-height: 2.4rem;
  }
}
</style>

<style scoped>
.preset-adapter-root {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  color: var(--SmartThemeBodyColor);
}

.preset-adapter-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.preset-adapter-header > div,
.preset-adapter-group-title {
  min-width: 0;
}

.preset-adapter-header h3,
.preset-adapter-group-header h4 {
  margin: 0;
  line-height: 1.25;
}

.preset-adapter-description {
  margin: 0.22rem 0 0;
  color: var(--SmartThemeEmColor);
  font-size: 0.88rem;
  line-height: 1.45;
}

.preset-adapter-preset {
  display: inline-block;
  margin-top: 0.35rem;
  color: var(--SmartThemeEmColor);
  font-size: 0.9rem;
}

.preset-adapter-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.preset-adapter-stats span {
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  background-color: var(--black30a);
  color: var(--SmartThemeEmColor);
  font-size: 0.85rem;
}

.preset-adapter-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2em;
  height: 2em;
  padding: 0;
}

.preset-adapter-errors {
  border: 1px solid var(--SmartThemeQuoteColor);
  border-radius: 8px;
  padding: 0.75rem;
  background-color: var(--black30a);
}

.preset-adapter-errors ul {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
  white-space: pre-wrap;
}

.preset-adapter-empty {
  border: 1px dashed var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 1rem;
  color: var(--SmartThemeEmColor);
  text-align: center;
}

.preset-adapter-group {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border-top: 1px solid var(--SmartThemeBorderColor);
  padding-top: 0.75rem;
}

.preset-adapter-group-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.preset-adapter-group-header span {
  flex: 0 0 auto;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  color: var(--SmartThemeEmColor);
  font-size: 0.85rem;
}

.preset-adapter-options {
  gap: 0.5rem;
}

.preset-adapter-options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
}

.preset-adapter-options-row {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
}

.preset-adapter-options-row .preset-adapter-option {
  min-width: 0;
}

.preset-adapter-option {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.25rem 0.5rem;
  align-items: center;
  min-height: 3.55rem;
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 8px;
  padding: 0.55rem 0.65rem;
  background-color: var(--black30a);
  color: var(--SmartThemeBodyColor);
  text-align: left;
  cursor: pointer;
}

.preset-adapter-option:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.preset-adapter-option:not(:disabled):hover {
  border-color: var(--SmartThemeUnderlineColor);
  background-color: var(--black50a);
}

.preset-adapter-option-main {
  display: inline-flex;
  align-items: flex-start;
  min-width: 0;
  gap: 0.45rem;
  font-weight: 700;
}

.preset-adapter-option-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.12rem;
}

.preset-adapter-option-title > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-option-title small {
  overflow: hidden;
  color: var(--SmartThemeEmColor);
  font-size: 0.8rem;
  font-weight: 400;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-adapter-option-active .preset-adapter-option-main i {
  color: var(--SmartThemeUnderlineColor);
}

.preset-adapter-option-unmatched .preset-adapter-option-main i {
  color: var(--SmartThemeEmColor);
}

.preset-adapter-options-row .preset-adapter-option {
  align-content: start;
}

@media (max-width: 720px) {
  .preset-adapter-header {
    gap: 0.6rem;
  }

  .preset-adapter-options-grid {
    grid-template-columns: 1fr;
  }

  .preset-adapter-option {
    min-height: 3.4rem;
  }
}
</style>
