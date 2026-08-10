<template>
  <section
    class="dca-workbench"
    :class="{ 'sidebar-collapsed': sidebarCollapsed }"
    :style="{ '--dca-sidebar-width': `${sidebarWidth}px` }"
  >
    <div class="dca-session-panel">
      <SessionToolbar :sidebar-collapsed="sidebarCollapsed" @toggle-sidebar="toggleSidebar" />
      <SessionTimeline @open-diff="openSidebar('diff')" />
      <SessionComposer />
    </div>
    <div
      v-if="!sidebarCollapsed"
      class="dca-sidebar-resizer"
      title="拖拽调整侧栏宽度"
      @pointerdown="beginSidebarResize"
    ></div>
    <SessionSidebar
      v-if="!sidebarCollapsed"
      v-model:tab="sidebarTab"
      :focus-file-path="focusFilePath"
      @close="sidebarCollapsed = true"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDreamCardAgent, type SidebarTab } from '../../composables/runtime';
import { useSidebarResize } from '../../composables/sidebar-resize';
import SessionComposer from './SessionComposer.vue';
import SessionTimeline from './SessionTimeline.vue';
import SessionToolbar from './SessionToolbar.vue';
import SessionSidebar from './sidebar/SessionSidebar.vue';

const { sidebarFocus, state } = useDreamCardAgent();

const sidebarCollapsed = ref(true);
const sidebarWidth = ref(390);
const sidebarTab = ref<SidebarTab>('files');
const focusFilePath = ref('');
const { beginSidebarResize } = useSidebarResize(sidebarWidth);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function openSidebar(tab: SidebarTab) {
  sidebarTab.value = tab;
  sidebarCollapsed.value = false;
}

// 其它区域（如 Skill 设置页）请求在侧栏中定位文件。
// immediate：请求可能在本组件挂载前就已发出（例如从设置页跳转过来）。
watch(
  sidebarFocus,
  request => {
    if (!request) return;
    if (!state.value.active) {
      sidebarFocus.value = undefined;
      return;
    }
    focusFilePath.value = request.filePath ?? '';
    openSidebar(request.tab);
    sidebarFocus.value = undefined;
  },
  { immediate: true },
);
</script>

<style lang="scss">
.dca-workbench {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) 6px minmax(20rem, var(--dca-sidebar-width));
}

.dca-workbench.sidebar-collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.dca-session-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.dca-sidebar-resizer {
  position: relative;
  min-width: 6px;
  background: var(--dca-surface);
  cursor: col-resize;
}

.dca-sidebar-resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: var(--dca-border);
  content: '';
  transition:
    left var(--dca-motion-fast) ease,
    width var(--dca-motion-fast) ease,
    background var(--dca-motion-fast) ease;
}

.dca-sidebar-resizer:hover::after,
.dca-resizing-sidebar .dca-sidebar-resizer::after {
  left: 1px;
  width: 3px;
  background: var(--dca-accent);
}

.dca-resizing-sidebar {
  cursor: col-resize !important;
  user-select: none !important;
}

@media (max-width: 720px) {
  .dca-workbench:not(.sidebar-collapsed) {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 62%) minmax(14rem, 38%);
  }

  .dca-sidebar-resizer {
    display: none;
  }
}
</style>
