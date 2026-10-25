<template>
  <div ref="appRoot" class="dca-app" :class="{ 'sidebar-collapsed': sidebarCollapsed && !isMobile, mobile: isMobile }">
    <PrimarySidebar v-if="!isMobile" />
    <section class="dca-workspace-surface">
      <WorkspaceTabs />
      <main class="dca-main" :inert="isMobile && mobileSurface === 'navigation'">
        <HomeView v-if="workspaceView === 'home'" />
        <SessionWorkbench v-else-if="workspaceView === 'session' && state.active" />
        <SettingsWorkspace v-else-if="workspaceView === 'settings'" />
        <section v-else class="dca-home">
          <div class="dca-empty dca-main-empty">这个会话页签当前不可用，请从主页重新打开。</div>
        </section>
      </main>
      <footer v-if="!isMobile" class="dca-workspace-status">
        <span>{{
          state.sessionBackup?.localPending
            ? '正在自动保存'
            : state.sessionBackup?.syncing
              ? '本机已保存 · 正在备份'
              : '工作台'
        }}</span
        ><NotificationButton />
      </footer>
      <NotificationHost />
    </section>
    <div v-if="isMobile && mobileSurface === 'navigation'" class="dca-mobile-navigation-layer">
      <button
        class="dca-mobile-navigation-scrim"
        type="button"
        aria-label="关闭角色与会话侧栏"
        @click="mobileSurface = 'workspace'"
      ></button>
      <PrimarySidebar />
    </div>
    <CharacterSwitchDialog />
    <SessionBackupDialog />
    <SkillEditorDialog />
    <OnboardingDialog />
  </div>
</template>

<script setup lang="ts">
import { notify } from './composables/notifications';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import HomeView from './components/home/HomeView.vue';
import OnboardingDialog from './components/OnboardingDialog.vue';
import CharacterSwitchDialog from './components/navigation/CharacterSwitchDialog.vue';
import PrimarySidebar from './components/navigation/PrimarySidebar.vue';
import SessionWorkbench from './components/session/SessionWorkbench.vue';
import SettingsWorkspace from './components/settings/SettingsWorkspace.vue';
import SkillEditorDialog from './components/SkillEditorDialog.vue';
import WorkspaceTabs from './components/WorkspaceTabs.vue';
import SessionBackupDialog from './components/SessionBackupDialog.vue';
import NotificationButton from './components/notifications/NotificationButton.vue';
import NotificationHost from './components/notifications/NotificationHost.vue';
import { provideDreamCardAgent } from './composables/runtime';
import { mountThemeRuntime, type MountedThemeRuntime } from './theme/runtime';
import { getThemeStore } from './theme/store';
import { DEFAULT_THEME_ID } from './theme/types';
import { clientEnvironment } from './runtime-client';

const { isMobile, mobileSurface, runtime, sidebarCollapsed, state, workspaceView } = provideDreamCardAgent();
const appRoot = ref<HTMLElement>();
const themeStore = getThemeStore();
let themeRuntime: MountedThemeRuntime | undefined;
let unsubscribeThemes = () => {};

function publishWindowLayout() {
  if (clientEnvironment()) return;
  const HostCustomEvent = window.parent.CustomEvent;
  window.parent.dispatchEvent(
    new HostCustomEvent('dream-card-agent:window-layout', {
      detail: { collapsed: sidebarCollapsed.value, mobile: isMobile.value },
    }),
  );
}

async function applyActiveTheme(id = state.value.activeThemeId) {
  try {
    await themeRuntime?.apply(id);
  } catch (error) {
    console.error('[梦境创客] 应用主题失败', error);
    notify.error(error instanceof Error ? error.message : String(error), '主题应用失败');
  }
}

onMounted(() => {
  if (!appRoot.value) return;
  themeRuntime = mountThemeRuntime(appRoot.value, {
    onError(error) {
      console.warn('[梦境创客] 主题脚本未能完整运行', error);
      notify.warning(error instanceof Error ? error.message : String(error), '主题脚本');
    },
  });
  unsubscribeThemes = themeStore.subscribe(() => {
    const activeId = state.value.activeThemeId;
    if (!themeStore.get(activeId)) void runtime.updateSettings({ activeThemeId: DEFAULT_THEME_ID });
    else void applyActiveTheme(activeId);
  });
  void applyActiveTheme();
});

watch(
  () => state.value.activeThemeId,
  id => void applyActiveTheme(id),
);

watch(
  () => state.value.active?.title,
  title => {
    if (clientEnvironment()?.mode === 'detached') document.title = title ? `${title} — 梦境创客` : '梦境创客';
  },
  { immediate: true },
);

watch([sidebarCollapsed, isMobile], publishWindowLayout, { immediate: true });

onBeforeUnmount(() => {
  unsubscribeThemes();
  themeRuntime?.destroy();
});
</script>

<style lang="scss">
@use './styles/tokens.scss';
@use './styles/base.scss';
@use './styles/shell.scss';
.dca-app {
  position: relative;
}
.dca-app .dca-mobile-back {
  min-width: 2.75rem;
  font-size: 1.4rem;
  padding: 0;
}
.dca-select-sheet-options {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.dca-select-container {
  display: contents;
}
.dca-select-sheet-options > button {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  text-align: left;
}
.dca-select-sheet-options > button span {
  display: flex;
  flex-direction: column;
}
.dca-select-sheet-options small {
  color: var(--dca-text-muted);
}
.dca-app .dca-mobile-sheet.dca-plus-menu .dca-sheet-body {
  display: flex;
  flex-direction: column;
}
.dca-app .dca-mobile-sheet.dca-model-menu-panel.level-models {
  height: min(32rem, calc(100% - 0.5rem));
}
.dca-mobile-sheet .dca-model-menu-title,
.dca-mobile-sheet .dca-model-subpage-header {
  display: none;
}
.dca-mobile-sheet.dca-model-menu-panel .dca-sheet-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}
.dca-mobile-sheet .dca-model-menu-page {
  flex: 1;
  min-height: 0;
}
.dca-mobile-sheet .dca-model-menu-root {
  overflow-y: auto;
}
.dca-mobile-sheet .dca-model-search {
  flex-shrink: 0;
}

.dca-main {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.dca-client-root .dca-tabs {
  padding-right: 0.5rem;
}
.dca-workspace-surface {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.dca-mobile-navigation-layer {
  position: absolute;
  z-index: 50;
  display: flex;
  overflow: hidden;
  inset: 2.8rem 0 0;
}

.dca-mobile-navigation-scrim {
  position: absolute;
  min-height: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  padding: 0 !important;
  background: var(--dca-scrim) !important;
  inset: 0;
}

.dca-mobile-navigation-layer > .dca-primary-sidebar {
  position: relative;
  z-index: 1;
  height: 100%;
}

.dca-workspace-status {
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  min-height: 1.8rem;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--dca-border);
  padding: 0 0.45rem 0 0.75rem;
  background: var(--dca-surface);
  color: var(--dca-text-muted);
  font-size: 0.7rem;
}

.dca-main-empty {
  width: min(30rem, 100%);
  margin: auto;
}
</style>
