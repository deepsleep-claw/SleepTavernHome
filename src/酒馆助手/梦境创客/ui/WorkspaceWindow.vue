<template>
  <div class="dca-app" :class="{ 'sidebar-collapsed': sidebarCollapsed && !isMobile, mobile: isMobile }">
    <PrimarySidebar v-if="!isMobile || mobileSurface === 'navigation'" />
    <section v-if="!isMobile || mobileSurface === 'workspace'" class="dca-workspace-surface">
      <div v-if="state.error" class="dca-alert dca-alert-error dca-app-alert">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <span>{{ state.error }}</span>
      </div>
      <WorkspaceTabs />
      <main class="dca-main">
        <HomeView v-if="workspaceView === 'home'" />
        <SessionWorkbench v-else-if="workspaceView === 'session' && state.active" />
        <SettingsWorkspace v-else-if="workspaceView === 'settings'" />
        <section v-else class="dca-home">
          <div class="dca-empty dca-main-empty">这个会话页签当前不可用，请从主页重新打开。</div>
        </section>
      </main>
    </section>
    <CharacterSwitchDialog />
    <SkillEditorDialog />
    <OnboardingDialog />
  </div>
</template>

<script setup lang="ts">
import HomeView from './components/home/HomeView.vue';
import OnboardingDialog from './components/OnboardingDialog.vue';
import CharacterSwitchDialog from './components/navigation/CharacterSwitchDialog.vue';
import PrimarySidebar from './components/navigation/PrimarySidebar.vue';
import SessionWorkbench from './components/session/SessionWorkbench.vue';
import SettingsWorkspace from './components/settings/SettingsWorkspace.vue';
import SkillEditorDialog from './components/SkillEditorDialog.vue';
import WorkspaceTabs from './components/WorkspaceTabs.vue';
import { provideDreamCardAgent } from './composables/runtime';

const { isMobile, mobileSurface, sidebarCollapsed, state, workspaceView } = provideDreamCardAgent();
</script>

<style lang="scss">
@use './styles/tokens.scss';
@use './styles/base.scss';
@use './styles/shell.scss';

.dca-main {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.dca-workspace-surface {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.dca-app-alert {
  margin: 0.5rem 0.65rem 0;
}

.dca-main-empty {
  width: min(30rem, 100%);
  margin: auto;
}
</style>
