<template>
  <section class="dca-settings-workspace">
    <aside class="dca-settings-nav">
      <strong>设置</strong>
      <button
        v-for="item in navItems"
        :key="item.section"
        type="button"
        :class="{ active: settingsSection === item.section }"
        @click="settingsSection = item.section"
      >
        <i :class="item.icon" aria-hidden="true"></i>{{ item.label }}
      </button>
    </aside>
    <div class="dca-settings-content">
      <div class="dca-settings-content-inner">
        <GeneralSettings v-if="settingsSection === 'general'" />
        <ThemeSettings v-else-if="settingsSection === 'theme'" />
        <AgentSettings v-else-if="settingsSection === 'agent'" />
        <PresetSettings v-else-if="settingsSection === 'preset'" />
        <ApiSettings v-else-if="settingsSection === 'api'" />
        <SkillSettings v-else-if="settingsSection === 'skills'" />
        <StorageSettings v-else-if="settingsSection === 'storage'" />
        <DiagnosticsSettings v-else-if="settingsSection === 'diagnostics'" />
        <UpdateSettings v-else />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import { useDreamCardAgent, type SettingsSection } from '../../composables/runtime';
import ApiSettings from './ApiSettings.vue';
import AgentSettings from './AgentSettings.vue';
import DiagnosticsSettings from './DiagnosticsSettings.vue';
import GeneralSettings from './GeneralSettings.vue';
import PresetSettings from './PresetSettings.vue';
import SkillSettings from './SkillSettings.vue';
import StorageSettings from './StorageSettings.vue';
import UpdateSettings from './UpdateSettings.vue';

const ThemeSettings = defineAsyncComponent(() => import('./ThemeSettings.vue'));

const { settingsSection } = useDreamCardAgent();

const navItems: { icon: string; label: string; section: SettingsSection }[] = [
  { icon: 'fa-solid fa-sliders', label: '常规', section: 'general' },
  { icon: 'fa-solid fa-palette', label: '主题', section: 'theme' },
  { icon: 'fa-solid fa-robot', label: 'Agent配置', section: 'agent' },
  { icon: 'fa-solid fa-layer-group', label: '预设', section: 'preset' },
  { icon: 'fa-solid fa-plug', label: 'API', section: 'api' },
  { icon: 'fa-solid fa-wand-magic-sparkles', label: 'Skill', section: 'skills' },
  { icon: 'fa-solid fa-hard-drive', label: '文件与存储', section: 'storage' },
  { icon: 'fa-solid fa-stethoscope', label: '诊断', section: 'diagnostics' },
  { icon: 'fa-solid fa-circle-arrow-up', label: '更新', section: 'update' },
];
</script>

<style lang="scss">
.dca-settings-workspace {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-columns: 10.5rem minmax(0, 1fr);
}

.dca-settings-nav {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border-right: 1px solid var(--dca-border);
  padding: 0.7rem 0.5rem;
  background: var(--dca-surface);
}

.dca-settings-nav > strong {
  padding: 0.3rem 0.5rem 0.55rem;
  font-size: 0.95rem;
}

.dca-app .dca-settings-nav button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: flex-start;
  border-color: transparent;
  background: transparent;
  color: var(--dca-text-secondary);
  text-align: left;
}

.dca-app .dca-settings-nav button:hover:not(:disabled) {
  border-color: transparent;
  background: var(--dca-accent-soft);
}

.dca-app .dca-settings-nav button.active {
  background: var(--dca-accent-soft);
  color: var(--dca-text);
  box-shadow: inset 2px 0 0 var(--dca-accent);
}

.dca-settings-nav button i {
  width: 1rem;
  color: var(--dca-text-muted);
  text-align: center;
}

.dca-settings-nav button.active i {
  color: var(--dca-accent);
}

.dca-settings-content {
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.dca-settings-content-inner {
  width: 100%;
  max-width: 60rem;
  min-height: 100%;
  margin: 0 auto;
}

@media (max-width: 720px) {
  .dca-settings-workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .dca-settings-nav {
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--dca-border);
    padding: 0.4rem;
  }

  .dca-settings-nav > strong {
    display: none;
  }

  .dca-settings-nav button {
    flex: 0 0 auto;
  }

  .dca-settings-nav button.active {
    box-shadow: inset 0 -2px 0 var(--dca-accent);
  }
}
</style>
